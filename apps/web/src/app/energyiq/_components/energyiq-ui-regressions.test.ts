import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { overviewViewStateFromSearchParams } from "./published-decision-dashboard";

const rendererSource = readFileSync(new URL("./energy-template-renderer.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./energyiq-shell.tsx", import.meta.url), "utf8");
const explorerSource = readFileSync(new URL("./project-explorer.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("./published-decision-dashboard.tsx", import.meta.url), "utf8");
const savedHistorySource = readFileSync(new URL("./saved-analysis-history.tsx", import.meta.url), "utf8");
const savedDetailSource = readFileSync(new URL("./saved-analysis-detail.tsx", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../admin/project-setup-workbench.tsx", import.meta.url), "utf8");
const adminSidebarSource = readFileSync(new URL("../admin/admin-sidebar.tsx", import.meta.url), "utf8");

describe("EnergyX UI regressions", () => {
  it("labels the operating-pattern curves and lists peak before average", () => {
    const start = rendererSource.indexOf("function OperatingPattern");
    const end = rendererSource.indexOf("function MeterBreakdown", start);
    const source = rendererSource.slice(start, end);

    expect(source).toContain("<Legend");
    expect(source).toContain('name="Observed peak"');
    expect(source).toContain('name="Hourly average"');
    expect(source.indexOf('name="Observed peak"')).toBeLessThan(source.indexOf('name="Hourly average"'));
  });

  it("keeps the sidebar dark in every language by styling a fixed attribute, not its translated label", () => {
    const themeSource = readFileSync(new URL("../energyiq-theme.css", import.meta.url), "utf8");
    expect(themeSource).not.toContain("aria-label");
    expect(themeSource).toContain("aside[data-energyiq-sidebar]");
    expect(shellSource).toContain("<aside data-energyiq-sidebar");
  });

  it("uses one shared project switcher instead of duplicate global selectors", () => {
    expect(shellSource.match(/<ProjectSwitcher\b/g)).toHaveLength(1);
    const switcherSource = readFileSync(new URL("./project-switcher.tsx", import.meta.url), "utf8");
    expect(switcherSource).toContain('aria-label={t("project.choose")}');
    expect(shellSource).not.toContain("Customer workspace");
  });

  it("offers bulk hierarchy expansion in Explorer and Admin Structure", () => {
    for (const source of [explorerSource, adminSource]) {
      expect(source).toContain('aria-label="Expand all hierarchy nodes"');
      expect(source).toContain('aria-label="Collapse all hierarchy nodes"');
    }
  });

  it("loads the administrator project picker across customer workspaces", () => {
    expect(adminSource).toContain("listEnergyAdminOrganisations");
    expect(adminSource).toContain("selectProjectContext");
  });

  it("lets administrators collapse and restore the desktop navigation", () => {
    expect(adminSidebarSource).toContain('aria-label="Collapse admin navigation"');
    expect(adminSidebarSource).toContain('aria-label="Show admin navigation"');
    expect(adminSidebarSource).toContain('aria-label={props.desktopCollapsed ? "Admin navigation rail"');
    expect(adminSource).not.toContain('aria-label="Show admin navigation"');
    expect(adminSidebarSource).not.toContain("Delivery, access and AI operations");
  });

  it("keeps module selection and layout controls beside Draft Preview", () => {
    expect(adminSource).toContain('aria-label={`Select ${component.display_name} module`}');
    expect(adminSource).toContain("Selected module settings");
    expect(adminSource).toContain("xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]");
  });

  it("restores the public Overview URL without shipping a demo range or browser month formula", () => {
    expect(overviewSource).not.toContain("demoRangeForProject");
    expect(overviewSource).not.toContain('value: "Last 30 days"');
    expect(overviewSource).toContain('{ label: "Previous month", value: "Previous month" }');
    expect(overviewViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=level-6&resource=electricity&period=Previous+month&from=2026-06-10&to=2026-06-16",
    ))).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-6",
      resource: "electricity",
      period: "Previous month",
      from: "",
      to: "",
      grain: "day",
      comparison: "overlay",
      category: "all",
    });
    expect(overviewViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=level-6&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16",
    ))).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-6",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      grain: "day",
      comparison: "overlay",
      category: "all",
    });
  });

  it("keeps Project Explorer as a narrow data-verification surface", () => {
    expect(explorerSource).not.toContain("ngeeAnnNodes");
    expect(explorerSource).not.toContain("Horizontal and vertical comparisons");
    expect(explorerSource).not.toContain("What needs attention");
    expect(explorerSource).not.toContain("Investigate with the advisor");
    expect(explorerSource).not.toContain("analysisPeriodForProject");
    expect(explorerSource).toContain("Period energy");
    expect(explorerSource).toContain("Daily average");
    expect(explorerSource).toContain("kWh/day");
    expect(explorerSource).toContain("Peak power");
    expect(explorerSource).toContain("Source & Data Health");
    expect(explorerSource).toContain("Technical provenance");
    expect(explorerSource).not.toContain("Browse configured project structure and meter evidence.");
    expect(explorerSource).not.toContain("A plain-language status first; technical trace remains available below");
    expect(explorerSource).not.toContain("Each Meter Point is queried within the selected Scope and period.");
    expect(explorerSource).not.toContain("Server-provided interval-average power grouped by local hour");
  });

  it("keeps saved analyses immutable and reruns them through the trusted API", () => {
    expect(overviewSource).toContain("saveEnergyAnalysis");
    expect(savedHistorySource).toContain("Immutable results saved manually from Overview");
    expect(savedHistorySource).toContain("Each rerun is a new version");
    expect(savedDetailSource).toContain("Read-only saved result");
    expect(savedDetailSource).toContain("rerunEnergySavedAnalysis");
    expect(savedDetailSource).toContain("<ProjectRenderer");
    expect(savedDetailSource).toContain('aiSlotMode="saved"');
    expect(savedDetailSource).toContain("savedAiArtifact");
    expect(savedDetailSource).toContain("window.print()");
    expect(savedDetailSource).not.toContain("contentEditable");
  });

  it("shows release-pinned metadata in Overview and only frozen metadata in Saved Analysis", () => {
    expect(overviewSource).toContain("<ScopeMetadataStatus metadata={currentSnapshot.metadata} mode=\"interactive\" />");
    expect(savedDetailSource).toContain("<ScopeMetadataStatus metadata={detail.analysis.metadata} mode=\"saved\" />");
    expect(savedDetailSource).not.toContain("resolveProjectAnalysis");
  });
});
