/** @vitest-environment happy-dom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnergySavedAnalysisAiArtifactDto, EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { PreschoolOverviewRenderer } from "./preschool-overview-renderer";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("PreschoolOverviewRenderer reading flow", () => {
  it("renders partial operational coverage and withholds cost when no accepted tariff covers the window", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    snapshot.preschoolOperational.contract = {
      id: "preschool-operational-behaviour",
      version: "4",
      spikeThresholdPct: 50,
    };
    snapshot.preschoolOperational.coverage = {
      status: "partial",
      expectedCellCount: 20_160,
      observedCellCount: 20_130,
      missingCellCount: 30,
      completeLocalDayCount: 27,
      partialLocalDayCount: 1,
      missingLocalHourCount: 1,
    };
    snapshot.preschoolOperational.energy.provisionalStandbyCostBeforeGstSgd = null;
    snapshot.preschoolOperational.energy.provisionalOperatingCostBeforeGstSgd = null;
    snapshot.preschoolOperational.standbyAppliances.applianceGroups.forEach((row) => {
      row.provisionalCostBeforeGstSgd = null;
    });
    snapshot.preschoolOperational.operatingAppliances.applianceGroups.forEach((row) => {
      row.provisionalCostBeforeGstSgd = null;
    });
    snapshot.preschoolOperational.standbyAppliances.appliances.forEach((row) => {
      row.provisionalCostBeforeGstSgd = null;
    });
    snapshot.preschoolOperational.operatingAppliances.appliances.forEach((row) => {
      row.provisionalCostBeforeGstSgd = null;
    });
    delete snapshot.preschoolOperational.tariffReference;

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
      />,
    );

    expect(markup).toContain("27 complete local days · 1 partial day · 1 missing whole-portfolio hour");
    expect(markup).toContain("No Release-pinned Tariff covers the full analysis period; energy remains available and cost is withheld.");
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain("S$846.40");
    expect(markup).not.toContain("S$5,949.78");
  });

  it("renders a Release-pinned Tariff assumption without inventing an external source link", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.analysis.cost = {
      status: "available",
      currency: "SGD",
      tariffScheduleVersion: "preschool-tariff-cross-month-v2",
      amount: 6_576.54,
      allocations: [
        {
          from: "2026-05-31T16:00:00.000Z",
          to: "2026-06-30T16:00:00.000Z",
          ratePerKwh: 0.25,
          usageKwh: 18_000,
          cost: 4_500,
        },
        {
          from: "2026-06-30T16:00:00.000Z",
          to: "2026-07-07T16:00:00.000Z",
          ratePerKwh: 0.3,
          usageKwh: 6_921.8,
          cost: 2_076.54,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
      />,
    );

    expect(markup).toContain("Release-pinned Tariff preschool-tariff-cross-month-v2");
    expect(markup).not.toMatch(/<a[^>]*>Release-pinned Tariff preschool-tariff-cross-month-v2<\/a>/);
  });

  it("renders the customer reading flow from Overall metrics through At a glance and Key Findings", () => {
    const snapshot = preschoolGoldenSnapshot();
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        savedAiArtifact={savedV4AiArtifact(snapshot)}
      />,
    );

    const expectedSections = [
      { id: "preschool-overall-summary", label: "Overview" },
      { id: "preschool-ai-analysis", label: "AI interpretation" },
      { id: "preschool-benchmark-analysis", label: "Benchmarks" },
      { id: "preschool-standby-wastage", label: "Standby wastage" },
      { id: "preschool-operating-hours", label: "Operating hours" },
      { id: "preschool-monthly-outlook", label: "Monthly outlook" },
      { id: "preschool-centre-ranking", label: "Centre detail" },
      { id: "preschool-evidence", label: "Supporting evidence" },
    ] as const;
    expect(markup.match(/data-overview-section=/g)).toHaveLength(expectedSections.length);
    expect(markup).toContain("Energy Review");
    expect(markup).toContain("Sections 1–4");
    expect(markup).toContain("Calendar-month window");
    expect(markup).toContain("Section 5");
    expect(markup).toContain("June 2026 plan / actual / outlook");
    expect(markup).toContain("Overall metrics");
    expect(markup).toContain("Energy use and estimated cost across 30 Centres.");
    expect(markup.match(/data-overall-summary-metric=/g)).toHaveLength(3);
    expect(markup).toContain("Total centres");
    expect(markup).toContain("Total energy · May 2026");
    expect(markup).toContain("Estimated total cost · May 2026");
    expect(markup).toContain("Energy &amp; cost by centre type");
    expect(markup).toContain(">Outlets</th>");
    expect(markup).toContain("Senior Care Center");
    expect(markup).toContain("11,637.00 kWh");
    expect(markup).toContain("All centres");
    expect(markup).toContain("24,921.81 kWh");
    expect(markup).toContain("100.0%");
    expect(markup).toContain("S$0.2727/kWh before GST");
    expect(markup.match(/Of energy in the current accepted window/g)).toHaveLength(2);
    expect(markup).not.toContain("Of accepted May Portfolio energy");
    expect(markup).not.toContain("Published Portfolio total for this Snapshot.");
    expect(markup).not.toContain("Average across the selected reporting window.");
    expect(markup).not.toContain("Centre rows returned by the authoritative Project analysis.");
    expect(markup).toContain('id="preschool-decision-summary"');
    expect(markup).toContain("At a glance");
    expect(markup).toContain('data-at-a-glance-grid="true"');
    expect(markup).toContain("md:grid-cols-2");
    expect(markup).toContain("Key Findings");
    expect(markup).toContain("Restored cross-section timing pattern");
    expect(markup).not.toContain("Portfolio energy overview");
    expect(markup).not.toContain("Overall consumption summary");
    expect(markup).not.toContain("AI Executive Summary");
    expect(markup).not.toContain("Verified section highlights");
    expect(markup).not.toContain("AI management brief");
    expect(markup.match(/data-key-finding-target=/g)).toHaveLength(4);
    expect(markup).toContain('href="#preschool-benchmark-analysis"');
    expect(markup).toContain('href="#preschool-standby-wastage"');
    expect(markup).toContain('href="#preschool-operating-hours"');
    expect(markup).toContain('href="#preschool-monthly-outlook"');
    expect(markup).toContain("Energy used after closing");
    expect(markup).toContain("Centres <strong class=\"font-semibold text-foreground\">L · E · N</strong>");
    expect(markup).toContain("High for both floor area and headcount");
    expect(markup).toContain("Unusual peaks during opening hours");
    expect(markup).toContain("A · B · C · D · E · +9 more");
    expect(markup).not.toContain("A · B · C · D · E · F · G · H · I · J · K · L · M · N");
    expect(markup).toContain("Estimated June 2026 energy");
    expect(markup).toContain("24,348 kWh");
    expect(markup).toContain("Limitation and evidence");
    expect(markup).not.toContain("What to do next");
    expect(markup).toContain("Monthly Energy Outlook");
    expect(markup).toContain("June 2026 · 1–30 Jun 2026");
    expect(markup).toContain("Expected June 2026 Energy");
    expect(markup).toContain("Expected June 2026 Cost");
    expect(markup).toContain("Consumed So Far");
    expect(markup).toContain("Pace vs Original Estimate");
    expect(markup).toContain("Method, tariff and evidence");
    expect(markup).toContain('data-forecast-status="waiting"');
    expect(markup).toContain("Awaiting first complete day");
    expect(markup).toContain("Actual not started");
    expect(markup).toContain("24,348 kWh");
    expect(markup).toContain("S$6,640");
    expect(markup).toContain("The Planning Baseline remains visible; no Actual is invented.");
    expect(markup).toContain("Centre A");
    expect(markup).toContain('data-series="planning-baseline"');
    expect(markup).toContain('d="" fill="none" stroke="currentColor" class="text-foreground"');
    expect(markup).toContain("View normalisation and evidence");
    const container = document.createElement("div");
    container.innerHTML = markup;
    const overallTotalRow = container.querySelector<HTMLElement>("#preschool-overall-summary tfoot tr");
    expect(overallTotalRow?.textContent).toContain("All centres");
    expect(overallTotalRow?.textContent).not.toContain("Portfolio total");
    const renderedSections = Array.from(container.querySelectorAll<HTMLElement>("[data-overview-section]"), (section) => ({
      id: section.id,
      label: section.dataset.overviewNavigationLabel,
    }));
    expect(renderedSections).toEqual(expectedSections);
    const sectionPositions = expectedSections.map((section) => markup.indexOf(`id="${section.id}"`));
    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(sectionPositions).toEqual([...sectionPositions].sort((left, right) => left - right));
    expect(markup.indexOf("Overall metrics")).toBeLessThan(markup.indexOf("At a glance"));
    expect(markup.indexOf("At a glance")).toBeLessThan(markup.indexOf("Restored cross-section timing pattern"));
    expect(markup.indexOf("Restored cross-section timing pattern")).toBeLessThan(markup.indexOf("Benchmark Analysis"));
    expect(markup.indexOf("Benchmark Analysis")).toBeLessThan(markup.indexOf("Standby Energy Wastage — Post Operating Hours"));
    expect(markup.indexOf("Standby Energy Wastage — Post Operating Hours")).toBeLessThan(markup.indexOf("Operating Hours Analysis"));
    expect(markup.indexOf("Operating Hours Analysis")).toBeLessThan(markup.indexOf("Monthly Energy Outlook"));
  });

  it("labels the Preschool report as Demo data and renders the complete month comparison", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.context.from = "2026-05-31T16:00:00.000Z";
    snapshot.context.to = "2026-06-30T16:00:00.000Z";
    snapshot.context.primaryPeriod = {
      start: snapshot.context.from,
      endExclusive: snapshot.context.to,
    };
    snapshot.analysis.summary.usageKwh = 27_000;
    snapshot.reportTimeContext = {
      policyId: "preschool-report-time",
      policyRevision: "2",
      timezone: "Asia/Singapore",
      asOf: "2026-07-01T00:15:00.000Z",
      dataThroughLocalDate: "2026-06-30",
      lastRefreshedAt: "2026-07-01T00:10:00.000Z",
      windows: [{
        windowId: "current-overview",
        role: "current_progress",
        label: "Current calendar month Report Edition",
        strategy: { kind: "calendar_month_to_date" },
        phase: "complete",
        from: "2026-05-31T16:00:00.000Z",
        toExclusive: "2026-06-30T16:00:00.000Z",
        completeDayCount: 30,
        segments: [],
        comparisonCompatibilityKey: "calendar-month",
      }],
    };
    snapshot.reportWindowSegmentSummaries = [{
      windowId: "previous-month-comparison",
      status: "ready",
      segments: [{
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
        dataStatus: "complete",
        expectedDayCount: 31,
        completeDayCount: 31,
        summary: { usageKwh: 24_800, averageDailyUsageKwh: 800 },
        evidence: { dataSnapshotId: snapshot.dataSnapshot.id, queryId: "daily_totals_v1" },
      }],
    }];

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
      />,
    );

    expect(markup).toContain("Demo data");
    expect(markup).toContain("June 2026 vs May 2026");
    expect(markup).toContain("27,000.00 kWh");
    expect(markup).toContain("24,800.00 kWh");
    expect(markup).toContain("+8.9%");
    expect(markup).toContain("Daily average");
    expect(markup).toContain("+12.5%");
    expect(markup).toContain(snapshot.dataSnapshot.id);
  });

  it("keeps the deterministic Overview and Section 2 visible when a saved AI read model is missing top-level Sections", () => {
    const snapshot = preschoolGoldenSnapshot();
    const savedAiArtifact = savedV4AiArtifact(snapshot);
    if (savedAiArtifact.contract !== "energyiq-saved-ai-result@2") throw new Error("v4 saved fixture missing");
    Reflect.deleteProperty(savedAiArtifact.result, "sections");

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        savedAiArtifact={savedAiArtifact}
      />,
    );

    expect(markup).toContain("Energy Review");
    expect(markup).toContain("Overall metrics");
    expect(markup).toContain("At a glance");
    expect(markup).toContain("Benchmark Analysis");
    expect(markup).toContain("Invalid saved AI read model");
    expect(markup).not.toContain("Restored cross-section timing pattern");
  });

  it("places current Additional AI Insights after Section 5 and keeps the deterministic Overview when it is unavailable", () => {
    const snapshot = preschoolGoldenSnapshot();
    const savedAiArtifact = savedV4AiArtifact(snapshot);
    if (savedAiArtifact.contract !== "energyiq-saved-ai-result@2") throw new Error("v4 saved fixture missing");
    Object.assign(savedAiArtifact.result, {
      additional: { status: "unavailable", artifactId: "additional-v2", reason: "ADDITIONAL_FAILED" },
    });

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        savedAiArtifact={savedAiArtifact}
      />,
    );

    expect(markup).toContain("Energy Review");
    expect(markup).toContain("Restored cross-section timing pattern");
    expect(markup).toContain("Monthly Energy Outlook");
    expect(markup).toContain("Additional AI Insights");
    expect(markup).toContain("Additional insights unavailable");
    expect(markup).toContain("Centre detail");
    expect(markup).toContain('id="preschool-additional-ai-insights"');
    expect(markup).toContain('data-overview-navigation-label="Additional AI Insights"');
    expect(markup.indexOf("Monthly Energy Outlook")).toBeLessThan(markup.indexOf("Additional AI Insights"));
    expect(markup.indexOf("Additional AI Insights")).toBeLessThan(markup.indexOf("Centre detail"));
  });

  it.each([
    {
      name: "Snapshot",
      mutate: (artifact: EnergySavedAnalysisAiArtifactDto) => Object.assign(artifact, { snapshotId: "other-snapshot" }),
    },
    {
      name: "Project Release",
      mutate: (artifact: EnergySavedAnalysisAiArtifactDto) => Object.assign(artifact, { projectReleaseId: "other-release" }),
    },
  ])("rejects a saved AI Artifact with a mismatched outer $name identity while preserving the Overview", ({ mutate }) => {
    const snapshot = preschoolGoldenSnapshot();
    const savedAiArtifact = savedV4AiArtifact(snapshot);
    mutate(savedAiArtifact);

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        savedAiArtifact={savedAiArtifact}
      />,
    );

    expect(markup).toContain("Energy Review");
    expect(markup).toContain("Overall metrics");
    expect(markup).toContain("At a glance");
    expect(markup).toContain("Benchmark Analysis");
    expect(markup).toContain("No completed AI result was attached");
    expect(markup).not.toContain("Restored cross-section timing pattern");
  });

  it.each([
    { contract: "energyiq-saved-ai-result@1" as const, shape: "missing findings" as const, findings: undefined },
    { contract: "energyiq-saved-ai-result@1" as const, shape: "non-array findings" as const, findings: "not-an-array" },
    { contract: "energyiq-saved-ai-result@1" as const, shape: "a null finding" as const, findings: [null] },
    { contract: "energyiq-saved-ai-result@1" as const, shape: "an invalid finding object" as const, findings: [{}] },
    { contract: "energyiq-saved-ai-result@2" as const, shape: "missing findings" as const, findings: undefined },
    { contract: "energyiq-saved-ai-result@2" as const, shape: "non-array findings" as const, findings: "not-an-array" },
    { contract: "energyiq-saved-ai-result@2" as const, shape: "a null finding" as const, findings: [null] },
    { contract: "energyiq-saved-ai-result@2" as const, shape: "an invalid finding object" as const, findings: [{}] },
  ])("fails closed for an outer-valid $contract non-sectioned payload with $shape", ({ contract, findings }) => {
    const snapshot = preschoolGoldenSnapshot();
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        savedAiArtifact={savedNonSectionedAiArtifact(snapshot, contract, findings)}
      />,
    );

    expect(markup).toContain("Energy Review");
    expect(markup).toContain("Overall metrics");
    expect(markup).toContain("At a glance");
    expect(markup).toContain("Benchmark Analysis");
    expect(markup).toContain("Invalid saved AI result");
    expect(markup).not.toContain("Malformed legacy finding");
  });

  it("preserves a valid frozen @1 non-sectioned Saved Analysis result", () => {
    const snapshot = preschoolGoldenSnapshot();
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        aiSlotMode="saved"
        savedAiArtifact={savedNonSectionedAiArtifact(snapshot, "energyiq-saved-ai-result@1", [])}
      />,
    );

    expect(markup).toContain("No additional Evidence-backed candidates");
    expect(markup).toContain("Saved AI result · Run legacy-saved-run");
    expect(markup).not.toContain("Invalid saved AI result");
  });

  it.each([
    { status: "waiting" as const, completeDays: 0, actualKwh: null, pacePct: null, label: "Awaiting first complete day" },
    { status: "partial" as const, completeDays: 7, actualKwh: 1_400, pacePct: 24.64, label: "Actual to date + remaining estimate" },
    { status: "complete" as const, completeDays: 30, actualKwh: 25_000, pacePct: 102.68, label: "Complete month · Above original estimate" },
  ])("renders the $status Forecast path with separately pinned Plan and Actual Evidence", ({ status, completeDays, actualKwh, pacePct, label }) => {
    const snapshot = preschoolGoldenSnapshot();
    attachForecastLifecycle(snapshot, { status, completeDays, actualKwh, pacePct });

    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const forecastSection = container.querySelector<HTMLElement>("#preschool-monthly-outlook")!;
    const forecastMarkup = forecastSection.innerHTML;

    expect(forecastMarkup).toContain(label);
    expect(forecastMarkup.match(/data-forecast-kpi=/g)).toHaveLength(4);
    expect(forecastMarkup).toContain("Original Estimate, Actual and Current Outlook");
    expect(forecastMarkup).toContain("Daily");
    expect(forecastMarkup).toContain("Weekly");
    expect(forecastMarkup).toContain("Monthly");
    expect(forecastMarkup).toContain("All centres");
    expect(forecastMarkup).toContain("Centre A");
    expect(forecastMarkup).toContain('data-series="original-estimate"');
    expect(forecastMarkup).toContain('data-series="current-outlook"');
    expect(forecastMarkup).toContain('stroke-dasharray="8 7"');
    expect(forecastMarkup).toContain('data-series="actual"');
    expect(forecastMarkup).toContain("Saved saved-a · Snapshot snapshot-a · daily_totals_v1");
    expect(forecastMarkup).toContain("Current Snapshot snapshot-b · daily_totals_v1");
    expect(forecastMarkup.indexOf("Expected June 2026 Energy")).toBeLessThan(forecastMarkup.indexOf("Original Estimate, Actual and Current Outlook"));
    expect(forecastMarkup.indexOf("Original Estimate, Actual and Current Outlook")).toBeLessThan(forecastMarkup.indexOf("Method, tariff and evidence"));
    expect(forecastMarkup.indexOf("Method, tariff and evidence")).toBeLessThan(forecastMarkup.indexOf("Four complete source weeks"));
  });

  it("shows only the first five Centres by default and retains the remaining rows in disclosure", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );

    expect(markup).toContain("Top 5 of 30 Centres");
    expect(markup).toContain("View all 30 Centres and normalised metrics");
    expect(markup.match(/data-centre-row=/g)).toHaveLength(30);
  });

  it("renders action-first benchmark summaries before collapsed empirical detail", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    const benchmarkSection = container.querySelector<HTMLElement>("#preschool-benchmark-analysis")!;
    expect(benchmarkSection.querySelector("[data-benchmark-interpretation-status]")?.getAttribute("data-benchmark-interpretation-status")).toBe("pending");
    expect(benchmarkSection.textContent).toContain("AI interpretation pending for this Snapshot.");
    expect(benchmarkSection.textContent).toContain("Centre Efficiency Metrics");
    expect(benchmarkSection.querySelectorAll("[data-benchmark-priority-label]")).toHaveLength(3);
    expect([...benchmarkSection.querySelectorAll("[data-benchmark-priority-label]")].map((node) => node.textContent?.trim())).toEqual([
      "3. Centre J",
      "2. Centre M",
      "1. Centre G",
    ]);
    expect([...benchmarkSection.querySelectorAll("[data-benchmark-priority-centre]")].map((node) => node.getAttribute("data-benchmark-priority-centre"))).toEqual(["G", "M", "J"]);
    expect(benchmarkSection.textContent).toContain("All-centre P75 review threshold");
    expect(benchmarkSection.querySelectorAll("[data-benchmark-summary]")).toHaveLength(2);
    expect(benchmarkSection.textContent).toContain("EUI Benchmark");
    expect(benchmarkSection.textContent).toContain("Per-pax Energy Benchmark");

    for (const summary of benchmarkSection.querySelectorAll<HTMLElement>("[data-benchmark-summary]")) {
      const header = summary.firstElementChild as HTMLElement;
      expect(header.classList.contains("min-w-[760px]")).toBe(true);
      expect(header.classList.contains("min-w-[900px]")).toBe(false);
      for (const column of ["outlets", "p50", "p75"]) {
        expect(summary.querySelector(`[data-benchmark-summary-header="${column}"]`)?.classList.contains("text-right")).toBe(false);
        expect([...summary.querySelectorAll(`[data-benchmark-summary-value="${column}"]`)]
          .every((value) => !value.classList.contains("text-right"))).toBe(true);
      }
    }

    const euiSenior = benchmarkSection.querySelector<HTMLElement>('[data-benchmark-summary-cohort="eui:Senior Care Center"]')!;
    expect(euiSenior.textContent).toContain("6.76");
    expect(euiSenior.textContent).toContain("9.20");
    expect(euiSenior.textContent).toContain("Centre J12.90");
    const activePerPaxAbove = [...benchmarkSection.querySelectorAll('[data-benchmark-summary-cohort="per-pax:Active Aging Center"] [data-benchmark-above-p75]')]
      .map((node) => node.getAttribute("data-benchmark-above-p75"));
    expect(activePerPaxAbove).toEqual(["per-pax:M", "per-pax:G"]);

    const details = benchmarkSection.querySelectorAll<HTMLDetailsElement>("details[data-benchmark-detail]");
    expect(details).toHaveLength(6);
    expect([...details].map((detail) => detail.dataset.benchmarkDetail)).toEqual([
      "eui:Senior Care Center",
      "eui:Active Aging Center",
      "eui:Preschool",
      "per-pax:Senior Care Center",
      "per-pax:Active Aging Center",
      "per-pax:Preschool",
    ]);
    expect([...details].every((detail) => !detail.open)).toBe(true);
    expect([...details].every((detail) => detail.querySelector<HTMLElement>(":scope > summary")?.tabIndex === 0)).toBe(true);
    expect([...details].every((detail) => detail.querySelector(":scope > summary")?.getAttribute("aria-label")?.includes("View detail."))).toBe(true);
    [...details].forEach((detail, index) => {
      detail.open = true;
      expect(detail.open).toBe(true);
      expect([...details].filter((candidate) => candidate.open).map((candidate) => candidate.dataset.benchmarkDetail)).toEqual([
        details[index]!.dataset.benchmarkDetail,
      ]);
      detail.open = false;
    });
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking^="eui:"] [data-benchmark-ranking-row]')).toHaveLength(30);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking^="per-pax:"] [data-benchmark-ranking-row]')).toHaveLength(30);
    const rankingScrollRegions = benchmarkSection.querySelectorAll<HTMLElement>("[data-benchmark-ranking-scroll]");
    expect(rankingScrollRegions).toHaveLength(6);
    expect([...rankingScrollRegions].every((region) => (
      region.getAttribute("role") === "region"
      && region.tabIndex === 0
      && region.getAttribute("aria-label")?.includes("Centre ranking, all")
      && region.classList.contains("max-h-64")
      && region.classList.contains("overflow-y-auto")
      && region.classList.contains("touch-pan-y")
    ))).toBe(true);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="eui:Senior Care Center"] [data-benchmark-ranking-row]')).toHaveLength(14);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="eui:Active Aging Center"] [data-benchmark-ranking-row]')).toHaveLength(8);
    expect(benchmarkSection.querySelectorAll('[data-benchmark-ranking="per-pax:Preschool"] [data-benchmark-ranking-row]')).toHaveLength(8);
    expect([...benchmarkSection.querySelectorAll('[data-benchmark-ranking="per-pax:Active Aging Center"] [data-benchmark-ranking-row]')].slice(0, 2)
      .map((node) => node.getAttribute("data-benchmark-ranking-row"))).toEqual([
      "per-pax:Active Aging Center:M",
      "per-pax:Active Aging Center:G",
    ]);
    expect(benchmarkSection.querySelector('[data-benchmark-detail="eui:Senior Care Center"]')?.textContent).not.toContain("Active Aging Center · n=");
    expect(benchmarkSection.textContent).not.toMatch(/bell curve/i);
  });

  it("only renders supplied benchmark interpretation when its identity matches the current Snapshot", () => {
    const snapshot = preschoolGoldenSnapshot();
    const staleMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        benchmarkInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: { start: "2026-05-10T16:00:00.000Z", endExclusive: "2026-06-07T16:00:00.000Z" },
          headline: "STALE_BENCHMARK_HEADLINE",
          takeaway: "STALE_BENCHMARK_SUMMARY",
          action: "STALE_BENCHMARK_ACTION",
          expectedIfAct: "STALE_BENCHMARK_EXPECTED",
          ifIgnored: "STALE_BENCHMARK_IGNORED",
          limitation: "STALE_BENCHMARK_LIMITATION",
        }}
      />,
    );
    expect(staleMarkup).not.toContain("STALE_BENCHMARK_HEADLINE");
    expect(staleMarkup).not.toContain("STALE_BENCHMARK_SUMMARY");
    expect(staleMarkup).toContain('data-benchmark-interpretation-status="unavailable"');

    const pendingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        benchmarkInterpretation={{
          status: "pending",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
        }}
      />,
    );
    expect(pendingMarkup).toContain('data-benchmark-interpretation-status="pending"');
    expect(pendingMarkup).toContain("AI interpretation pending for this Snapshot.");

    const matchingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        benchmarkInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
          headline: "MATCHING_BENCHMARK_HEADLINE",
          takeaway: "MATCHING_BENCHMARK_SUMMARY",
          whyItMatters: "MATCHING_BENCHMARK_WHY",
          action: "MATCHING_BENCHMARK_ACTION",
          expectedIfAct: "MATCHING_BENCHMARK_EXPECTED",
          ifIgnored: "MATCHING_BENCHMARK_IGNORED",
          verification: "MATCHING_BENCHMARK_VERIFY",
          limitation: "MATCHING_BENCHMARK_LIMITATION",
          presentation: {
            version: "1",
            blocks: [{
              type: "comparison",
              title: "MATCHING_BENCHMARK_CHART",
              items: [{ label: "Centre G", value: 19.39 }, { label: "Peer P75", value: 15.13 }],
              evidenceRefs: ["benchmark:priority"],
            }],
          },
        }}
      />,
    );
    expect(matchingMarkup).toContain('data-benchmark-interpretation-status="available"');
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_HEADLINE");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_SUMMARY");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_ACTION");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_WHY");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_EXPECTED");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_IGNORED");
    expect(matchingMarkup).toContain("MATCHING_BENCHMARK_CHART");
    expect(matchingMarkup).toContain('data-presentation-type="comparison"');
  });

  it("renders the Standby decision path from five KPIs to closed-state Appliance evidence, Centre events and review priority", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const standbySection = container.querySelector<HTMLElement>("#preschool-standby-wastage")!;

    expect(standbySection.querySelector("[data-standby-interpretation-status]")?.getAttribute("data-standby-interpretation-status")).toBe("pending");
    expect(standbySection.textContent).toContain("AI interpretation pending for this Snapshot.");
    expect(standbySection.querySelectorAll("[data-standby-kpis] > div")).toHaveLength(5);
    expect(standbySection.textContent).toContain("3,103.78 kWh");
    expect(standbySection.textContent).toContain("S$846.40");
    expect(standbySection.textContent).toContain("Before GST reference · not a bill");
    expect(standbySection.textContent).toContain("12.5%");
    expect(standbySection.textContent).toContain("Unusual closed-hour Spikes7");
    expect(standbySection.textContent).toContain("Centres to review3");

    expect(standbySection.textContent).toContain("Standby Energy by Appliance");
    const standbySegments = standbySection.querySelectorAll<SVGElement>("[data-standby-appliance-segment]");
    const standbyApplianceRows = standbySection.querySelectorAll<HTMLElement>("[data-standby-appliance]");
    expect(standbySegments).toHaveLength(9);
    expect([...standbySegments].map((node) => node.getAttribute("data-standby-appliance-segment")))
      .toEqual([...standbyApplianceRows].map((node) => node.getAttribute("data-standby-appliance")));
    expect([...standbySegments].every((node) => (
      node.tabIndex === 0
      && node.getAttribute("aria-label")?.includes("kWh")
      && node.getAttribute("aria-label")?.includes("%")
    ))).toBe(true);
    expect(standbySection.querySelectorAll('[data-operating-state-appliance-tooltip^="standby:"]')).toHaveLength(9);
    expect(standbySection.querySelectorAll('[data-operating-state-appliance-legend^="standby:"]')).toHaveLength(0);
    const standbyComposition = standbySection.querySelector<HTMLElement>("[data-standby-appliance-composition]")!;
    expect(standbyComposition.innerHTML.indexOf('data-operating-state-appliance-total="standby"'))
      .toBeLessThan(standbyComposition.innerHTML.indexOf('data-operating-state-appliance-tooltip="standby:Plug Load3"'));
    expect(standbyComposition.querySelector('[data-operating-state-appliance-tooltip="standby:Plug Load3"] rect')?.getAttribute("x")).toBe("80");
    expect(standbyComposition.querySelector('[data-operating-state-appliance-tooltip="standby:Plug Load3"] rect')?.getAttribute("width")).toBe("140");
    expect(standbySection.querySelectorAll("[data-standby-appliance-group]")).toHaveLength(0);
    expect(standbySection.querySelectorAll("[data-standby-appliance]")).toHaveLength(9);
    expect(standbySection.querySelector("[data-standby-appliance]")?.getAttribute("data-standby-appliance")).toBe("Plug Load3");
    expect([...standbyApplianceRows].map((node) => node.getAttribute("data-appliance-series-index"))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(standbySection.textContent).toContain("40.0%");
    expect(standbySection.textContent).not.toContain("Plug Load3 · Living Area Plug Load · Kitchen Plug Load");

    expect(standbySection.textContent).toContain("Non-operating Hours Spike Analysis");
    const standbySpikeTable = standbySection.querySelector<HTMLElement>("[data-standby-spike-table]")!;
    expect(standbySpikeTable.classList.contains("overflow-x-auto")).toBe(false);
    expect(standbySpikeTable.classList.contains("overflow-hidden")).toBe(true);
    expect(standbySpikeTable.outerHTML).not.toContain("min-w-[1060px]");
    const centreDetails = standbySection.querySelectorAll<HTMLDetailsElement>("details[data-standby-spike-centre]");
    expect([...centreDetails].map((detail) => detail.dataset.standbySpikeCentre)).toEqual(["L", "E", "N"]);
    expect([...centreDetails].map((detail) => detail.querySelectorAll("[data-standby-spike-event]").length)).toEqual([4, 2, 1]);
    expect([...centreDetails].every((detail) => detail.querySelector<HTMLElement>(":scope > summary")?.tabIndex === 0)).toBe(true);
    expect([...centreDetails].every((detail) => detail.querySelector(":scope > summary")?.classList.contains("grid-cols-2"))).toBe(true);
    expect([...standbySection.querySelectorAll<HTMLElement>("[data-standby-spike-event]")].every((event) => event.classList.contains("grid-cols-2"))).toBe(true);
    expect(centreDetails[0]?.querySelectorAll('[data-standby-spike-event^="E:"]')).toHaveLength(0);
    centreDetails[0]!.open = true;
    expect(centreDetails[0]!.open).toBe(true);
    centreDetails[0]!.open = false;

    expect(standbySection.textContent).toContain("After-hours Review Priority");
    expect([...standbySection.querySelectorAll("[data-review-priority-centre]")].map((node) => node.getAttribute("data-review-priority-centre")))
      .toEqual(["L", "E", "N"]);
    expect([...standbySection.querySelectorAll<HTMLElement>("[data-review-priority-centre]")].every((row) => (
      row.classList.contains("sm:grid-cols-2") && [...row.classList].some((className) => className.startsWith("xl:grid-cols-["))
    ))).toBe(true);
    expect(standbySection.textContent).toContain("confirm the Calendar, operating SOP and equipment state with the Centre");
    expect(standbySection.textContent).toContain("does not measure SOP compliance");
    expect(standbySection.textContent).not.toContain("SOP Compliance Score");
    expect(standbySection.textContent).toContain("not confirmed root causes");
    expect(standbySection.textContent).toContain("not guaranteed savings");
  });

  it("only renders Standby interpretation when Snapshot, Release and period identities all match", () => {
    const snapshot = preschoolGoldenSnapshot();
    const staleMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        standbyInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: { start: "2026-05-10T16:00:00.000Z", endExclusive: "2026-06-07T16:00:00.000Z" },
          headline: "STALE_STANDBY_HEADLINE",
          takeaway: "STALE_STANDBY_SUMMARY",
          action: "STALE_STANDBY_ACTION",
          expectedIfAct: "STALE_STANDBY_EXPECTED",
          ifIgnored: "STALE_STANDBY_IGNORED",
          limitation: "STALE_STANDBY_LIMITATION",
        }}
      />,
    );
    expect(staleMarkup).not.toContain("STALE_STANDBY_HEADLINE");
    expect(staleMarkup).not.toContain("STALE_STANDBY_SUMMARY");
    expect(staleMarkup).toContain('data-standby-interpretation-status="unavailable"');

    const pendingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        standbyInterpretation={{
          status: "pending",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
        }}
      />,
    );
    expect(pendingMarkup).toContain('data-standby-interpretation-status="pending"');

    const matchingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        standbyInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
          headline: "MATCHING_STANDBY_HEADLINE",
          takeaway: "MATCHING_STANDBY_SUMMARY",
          action: "MATCHING_STANDBY_ACTION",
          expectedIfAct: "MATCHING_STANDBY_EXPECTED",
          ifIgnored: "MATCHING_STANDBY_IGNORED",
          limitation: "MATCHING_STANDBY_LIMITATION",
        }}
      />,
    );
    expect(matchingMarkup).toContain('data-standby-interpretation-status="available"');
    expect(matchingMarkup).toContain("MATCHING_STANDBY_HEADLINE");
    expect(matchingMarkup).toContain("MATCHING_STANDBY_SUMMARY");
    expect(matchingMarkup).toContain("MATCHING_STANDBY_ACTION");
  });

  it("renders the Operating-hours decision path from five KPIs to state-specific Appliance and complete Centre evidence", () => {
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer state={{ status: "ready", snapshot: preschoolGoldenSnapshot() }} />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const operatingSection = container.querySelector<HTMLElement>("#preschool-operating-hours")!;

    expect(operatingSection.querySelector("[data-operating-interpretation-status]")?.getAttribute("data-operating-interpretation-status")).toBe("unavailable");
    expect(operatingSection.textContent).toContain("No matching AI interpretation is available for this Snapshot.");
    expect(operatingSection.querySelectorAll("[data-operating-kpis] > div")).toHaveLength(5);
    expect(operatingSection.textContent).toContain("21,818.03 kWh");
    expect(operatingSection.textContent).toContain("S$5,949.78");
    expect(operatingSection.textContent).toContain("Before GST reference · not a bill");
    expect(operatingSection.textContent).toContain("87.5%");
    expect(operatingSection.textContent).toContain("Unusual operating-hour Spikes21");
    expect(operatingSection.textContent).toContain("Centres to review14");

    expect(operatingSection.textContent).toContain("Operating Energy by Appliance");
    const operatingSegments = operatingSection.querySelectorAll<SVGElement>("[data-operating-appliance-segment]");
    const operatingApplianceRows = operatingSection.querySelectorAll<HTMLElement>("[data-operating-appliance]");
    expect(operatingSegments).toHaveLength(9);
    expect([...operatingSegments].map((node) => node.getAttribute("data-operating-appliance-segment")))
      .toEqual([...operatingApplianceRows].map((node) => node.getAttribute("data-operating-appliance")));
    expect([...operatingSegments].every((node) => node.tabIndex === 0 && node.getAttribute("aria-label")?.includes("kWh"))).toBe(true);
    expect(operatingSection.querySelectorAll('[data-operating-state-appliance-tooltip^="operating:"]')).toHaveLength(9);
    expect(operatingSection.querySelectorAll('[data-operating-state-appliance-legend^="operating:"]')).toHaveLength(0);
    const operatingComposition = operatingSection.querySelector<HTMLElement>("[data-operating-appliance-composition]")!;
    expect(operatingComposition.innerHTML.indexOf('data-operating-state-appliance-total="operating"'))
      .toBeLessThan(operatingComposition.innerHTML.indexOf('data-operating-state-appliance-tooltip="operating:Plug Load3"'));
    expect(operatingSection.querySelectorAll("[data-operating-appliance-group]")).toHaveLength(0);
    expect(operatingSection.querySelectorAll("[data-operating-appliance]")).toHaveLength(9);
    expect(operatingSection.querySelector("[data-operating-appliance]")?.getAttribute("data-operating-appliance")).toBe("Plug Load3");
    expect([...operatingApplianceRows].map((node) => node.getAttribute("data-appliance-series-index"))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

    expect(operatingSection.textContent).toContain("Operating Hours Spike Analysis");
    const operatingSpikeTable = operatingSection.querySelector<HTMLElement>("[data-operating-spike-table]")!;
    expect(operatingSpikeTable.classList.contains("overflow-x-auto")).toBe(false);
    expect(operatingSpikeTable.classList.contains("overflow-hidden")).toBe(true);
    expect(operatingSpikeTable.outerHTML).not.toContain("min-w-[1060px]");
    const centreDetails = operatingSection.querySelectorAll<HTMLDetailsElement>("details[data-operating-spike-centre]");
    expect([...centreDetails].map((detail) => detail.dataset.operatingSpikeCentre)).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N",
    ]);
    expect([...centreDetails].map((detail) => detail.querySelectorAll("[data-operating-spike-event]").length))
      .toEqual([8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...centreDetails].every((detail) => detail.querySelector<HTMLElement>(":scope > summary")?.tabIndex === 0)).toBe(true);
    expect([...centreDetails].every((detail) => detail.querySelector(":scope > summary")?.classList.contains("grid-cols-2"))).toBe(true);
    expect([...operatingSection.querySelectorAll<HTMLElement>("[data-operating-spike-event]")].every((event) => event.classList.contains("grid-cols-2"))).toBe(true);
    expect(centreDetails[0]?.querySelectorAll('[data-operating-spike-event^="B:"]')).toHaveLength(0);
    centreDetails[0]!.open = true;
    expect(centreDetails[0]!.open).toBe(true);
    centreDetails[0]!.open = false;

    expect(operatingSection.textContent).toMatch(/observed leading contributor/i);
    expect(operatingSection.textContent).not.toMatch(/root cause\s*:/i);
    expect(operatingSection.textContent).not.toContain("Potential Saving");
    const supportingContext = operatingSection.querySelector<HTMLDetailsElement>("[data-all-hours-appliance-context]");
    expect(supportingContext).not.toBeNull();
    expect(supportingContext!.open).toBe(false);

    const readingOrder = [
      "Key focus / AI interpretation",
      "Total operating energy",
      "Operating Energy by Appliance",
      "Operating Hours Spike Analysis",
      "Supporting Evidence · all-hours Appliance context across all Centres",
      "Method, tariff and evidence",
    ].map((label) => operatingSection.textContent!.indexOf(label));
    expect(readingOrder.every((position) => position >= 0)).toBe(true);
    expect(readingOrder).toEqual([...readingOrder].sort((left, right) => left - right));
  });

  it("only renders Operating-hours interpretation when Snapshot, Release and period identities all match", () => {
    const snapshot = preschoolGoldenSnapshot();
    const staleMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        operatingInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: { start: "2026-05-10T16:00:00.000Z", endExclusive: "2026-06-07T16:00:00.000Z" },
          headline: "STALE_OPERATING_HEADLINE",
          takeaway: "STALE_OPERATING_SUMMARY",
          action: "STALE_OPERATING_ACTION",
          expectedIfAct: "STALE_OPERATING_EXPECTED",
          ifIgnored: "STALE_OPERATING_IGNORED",
          limitation: "STALE_OPERATING_LIMITATION",
        }}
      />,
    );
    expect(staleMarkup).not.toContain("STALE_OPERATING_HEADLINE");
    expect(staleMarkup).not.toContain("STALE_OPERATING_SUMMARY");
    expect(staleMarkup).toContain('data-operating-interpretation-status="unavailable"');

    const pendingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        operatingInterpretation={{
          status: "pending",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
        }}
      />,
    );
    expect(pendingMarkup).toContain('data-operating-interpretation-status="pending"');

    const matchingMarkup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        operatingInterpretation={{
          status: "available",
          dataSnapshotId: snapshot.dataSnapshot.id,
          projectReleaseId: snapshot.projectRelease.id,
          period: snapshot.context.primaryPeriod,
          headline: "MATCHING_OPERATING_HEADLINE",
          takeaway: "MATCHING_OPERATING_SUMMARY",
          action: "MATCHING_OPERATING_ACTION",
          expectedIfAct: "MATCHING_OPERATING_EXPECTED",
          ifIgnored: "MATCHING_OPERATING_IGNORED",
          limitation: "MATCHING_OPERATING_LIMITATION",
        }}
      />,
    );
    expect(matchingMarkup).toContain('data-operating-interpretation-status="available"');
    expect(matchingMarkup).toContain("MATCHING_OPERATING_HEADLINE");
    expect(matchingMarkup).toContain("MATCHING_OPERATING_SUMMARY");
    expect(matchingMarkup).toContain("MATCHING_OPERATING_ACTION");
  });

  it("links a visible Centre to its exact Explorer Scope without dropping Snapshot pins", () => {
    const snapshot = preschoolGoldenSnapshot();
    const projectExplorerHref = [
      "/energyiq/explorer?projectId=preschool-demo",
      "scopeId=project",
      "resource=electricity",
      "period=Custom",
      "from=2026-05-01",
      "to=2026-05-31",
      `dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`,
      `projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    ].join("&");
    const markup = renderToStaticMarkup(
      <PreschoolOverviewRenderer
        state={{ status: "ready", snapshot }}
        projectExplorerHref={projectExplorerHref}
      />,
    );

    const container = document.createElement("div");
    container.innerHTML = markup;
    const centreLink = container.querySelector<HTMLAnchorElement>("[data-centre-explorer-link]");
    expect(centreLink).not.toBeNull();
    const linkedScopeId = centreLink!.dataset.centreExplorerLink;
    expect(linkedScopeId).toBeTruthy();
    const centreUrl = new URL(centreLink!.href);
    expect(Object.fromEntries(centreUrl.searchParams)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: linkedScopeId,
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
  });
});

const attachForecastLifecycle = (
  snapshot: ReturnType<typeof preschoolGoldenSnapshot>,
  input: {
    status: "waiting" | "partial" | "complete";
    completeDays: number;
    actualKwh: number | null;
    pacePct: number | null;
  },
) => {
  if (
    snapshot.preschoolOperational?.status !== "available"
    || snapshot.preschoolOperational.planningOutlook.status !== "provisional"
  ) throw new Error("Expected planning fixture");
  const plan = structuredClone(snapshot.preschoolOperational.planningOutlook);
  plan.evidence.dataSnapshotId = "snapshot-a";
  const daily = Array.from({ length: 30 }, (_, index) => ({
    start: `2026-06-${String(index + 1).padStart(2, "0")}`,
    endExclusive: index === 29 ? "2026-07-01" : `2026-06-${String(index + 2).padStart(2, "0")}`,
    estimatedKwh: plan.usageEstimate.projectedKwh / 30,
    originalEstimateKwh: plan.usageEstimate.projectedKwh / 30,
    actualKwh: index < input.completeDays && input.actualKwh !== null ? input.actualKwh / input.completeDays : null,
    currentOutlookKwh: index < input.completeDays && input.actualKwh !== null
      ? input.actualKwh / input.completeDays
      : plan.usageEstimate.projectedKwh / 30,
    futureOutlookKwh: index < input.completeDays
      ? null
      : plan.usageEstimate.projectedKwh / 30,
    actualCompleteDayCount: index < input.completeDays ? 1 : 0,
    actualTargetDayCount: 1,
    actualStatus: index < input.completeDays ? "complete" as const : "waiting" as const,
  }));
  const aggregate = (size: number) => Array.from({ length: Math.ceil(30 / size) }, (_, bucketIndex) => {
    const rows = daily.slice(bucketIndex * size, (bucketIndex + 1) * size);
    const actualRows = rows.filter((row) => row.actualKwh !== null);
    const futureRows = rows.filter((row) => row.futureOutlookKwh !== null);
    return {
      start: rows[0]!.start,
      endExclusive: rows.at(-1)!.endExclusive,
      estimatedKwh: rows.reduce((sum, row) => sum + row.estimatedKwh, 0),
      originalEstimateKwh: rows.reduce((sum, row) => sum + row.originalEstimateKwh, 0),
      actualKwh: actualRows.length === 0 ? null : actualRows.reduce((sum, row) => sum + row.actualKwh!, 0),
      currentOutlookKwh: rows.reduce((sum, row) => sum + row.currentOutlookKwh, 0),
      futureOutlookKwh: futureRows.length === 0
        ? null
        : futureRows.reduce((sum, row) => sum + row.futureOutlookKwh!, 0),
      actualCompleteDayCount: actualRows.length,
      actualTargetDayCount: rows.length,
      actualStatus: actualRows.length === 0 ? "waiting" as const : actualRows.length === rows.length ? "complete" as const : "partial" as const,
    };
  });
  const portfolioScope = {
    scopeId: snapshot.context.scopeId,
    scopeName: snapshot.context.scopeName,
    scopeType: "project",
    scopeRole: "portfolio" as const,
    estimatedKwh: plan.usageEstimate.projectedKwh,
    estimatedCostBeforeGstSgd: plan.costEstimate.projectedBeforeGstSgd,
    expectedFullMonthKwh: daily.reduce((sum, row) => sum + row.currentOutlookKwh, 0),
    expectedFullMonthCostBeforeGstSgd: daily.reduce((sum, row) => sum + row.currentOutlookKwh, 0) * 0.2727,
    actualKwh: input.actualKwh,
    actualCostBeforeGstSgd: input.actualKwh === null ? null : input.actualKwh * 0.2727,
    actualCompleteDayCount: input.completeDays,
    actualTargetDayCount: 30 as const,
    actualThroughLocalDate: input.completeDays === 0
      ? null
      : `2026-06-${String(input.completeDays).padStart(2, "0")}`,
    pacePct: input.pacePct,
    outcome: input.status === "complete" ? "above_plan" as const : null,
    originalEstimateIdentity: "saved-a:2026-06-01:snapshot-a:preschool-weekday-mean-series-v1",
    actualIdentity: `snapshot-b:2026-06-01:${input.completeDays}`,
    currentOutlookIdentity: `saved-a:snapshot-b:${input.completeDays}`,
    buckets: { daily, weekly: aggregate(7), monthly: aggregate(30) },
  };
  Reflect.set(snapshot, "preschoolPlanningLifecycle", {
    status: "available",
    contract: { id: "preschool-saved-plan-current-actual", version: "2" },
    targetPeriod: {
      start: "2026-06-01",
      endExclusive: "2026-07-01",
      timezone: "Asia/Singapore",
      targetDayCount: 30,
    },
    plan,
    actual: {
      status: input.status === "complete" ? "complete" : "partial",
      usageKwh: input.actualKwh,
      completeDayCount: input.completeDays,
      targetDayCount: 30,
      varianceKwh: input.status === "complete" ? 651.79 : null,
      variancePct: input.status === "complete" ? 2.68 : null,
    },
    forecast: {
      status: input.status,
      contract: {
        id: "preschool-monthly-energy-outlook",
        version: "2",
        method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
      },
      targetPeriod: {
        start: "2026-06-01",
        endExclusive: "2026-07-01",
        timezone: "Asia/Singapore",
        targetDayCount: 30,
      },
      tariffAssumption: {
        status: "effective",
        beforeGstSgdPerKwh: 0.2727,
        sourceName: "SP Group",
        sourceUrl: "https://example.com/tariff",
        supplyClass: "Low tension, non-domestic",
        appliesFrom: "2026-04-01",
        appliesTo: "2026-06-30",
        beforeGst: true,
        notBill: true,
      },
      scopes: [
        portfolioScope,
        {
          ...portfolioScope,
          scopeId: "centre-a",
          scopeName: "Centre A",
          scopeType: "centre",
          scopeRole: "centre",
          estimatedKwh: 6_000,
          estimatedCostBeforeGstSgd: 1_636.2,
        },
      ],
      evidence: {
        planDataSnapshotId: "snapshot-a",
        actualDataSnapshotId: "snapshot-b",
        planQueryId: "daily_totals_v1",
        actualQueryId: "daily_totals_v1",
        recipeId: "preschool-weekday-mean-series-v1",
      },
    },
    planProvenance: {
      savedAnalysisId: "saved-a",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: snapshot.projectRelease.id,
      templateRevisionId: snapshot.projectRelease.templateRevisionId,
      queryId: "daily_totals_v1",
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId: "snapshot-b",
      projectReleaseId: snapshot.projectRelease.id,
      queryId: "daily_totals_v1",
      period: { start: "2026-06-01", endExclusive: "2026-07-01", timezone: "Asia/Singapore" },
    },
  });
};

function savedV4AiArtifact(snapshot: EnergyProjectAnalysisSnapshotDto): EnergySavedAnalysisAiArtifactDto {
  const binding = {
    workspaceId: snapshot.context.workspaceId,
    projectId: "preschool-demo" as const,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  };
  const emptySection = (sectionId: "standby-wastage" | "operating-behaviour" | "planning-outlook", runId: string) => ({
    status: "empty" as const,
    artifactId: `section-${sectionId}-v4`,
    result: {
      artifactKind: "section-interpretation" as const,
      status: "empty" as const,
      providerProfileId: binding.modelProfileId,
      runId,
      binding,
      sectionId,
      insights: [] as [],
    },
  });

  return {
    contract: "energyiq-saved-ai-result@2",
    rendererKey: "preschool-overview",
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    completedAt: "2026-08-13T00:00:00.000Z",
    result: {
      artifactKind: "preschool-overview-ai-read-model",
      status: "available",
      binding,
      sections: {
        "centre-benchmark": {
          status: "available",
          artifactId: "section-benchmark-v4",
          result: {
            artifactKind: "section-interpretation",
            status: "available",
            providerProfileId: binding.modelProfileId,
            runId: "run-benchmark-v4",
            binding,
            sectionId: "centre-benchmark",
            summary: {
              text: "The restored benchmark interpretation remains beside Section 2.",
              evidenceRefs: ["benchmark:portfolio"],
            },
            insights: [],
          },
        },
        "standby-wastage": emptySection("standby-wastage", "run-standby-v4"),
        "operating-behaviour": emptySection("operating-behaviour", "run-operating-v4"),
        "planning-outlook": emptySection("planning-outlook", "run-planning-v4"),
      },
      executive: {
        status: "available",
        artifactId: "key-findings-v4",
        result: {
          artifactKind: "executive-synthesis",
          status: "available",
          providerProfileId: binding.modelProfileId,
          runId: "run-key-findings-v4",
          binding,
          sourceSectionArtifactIds: ["section-benchmark-v4"],
          summary: {
            text: "Restored cross-section timing pattern",
            evidenceRefs: ["benchmark:portfolio"],
          },
          findings: [],
        },
      },
    },
  };
}

function savedNonSectionedAiArtifact(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  contract: "energyiq-saved-ai-result@1" | "energyiq-saved-ai-result@2",
  findings: unknown,
): EnergySavedAnalysisAiArtifactDto {
  const result: Record<string, unknown> = {
    status: "available",
    providerProfileId: "legacy-model-profile",
    runId: "legacy-saved-run",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
  };
  if (findings !== undefined) result.findings = findings;
  return {
    contract,
    rendererKey: "preschool-overview",
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    completedAt: "2026-08-13T00:00:00.000Z",
    result,
  } as unknown as EnergySavedAnalysisAiArtifactDto;
}
