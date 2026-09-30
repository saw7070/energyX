/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESCHOOL_HTML_AI_SLOT_IDS, reportTimeBasisFromContext } from "@datafoundry/contracts";

import type {
  EnergyAccessContextDto,
  EnergyComponentRevisionDto,
  EnergyProjectAnalysisMetadataDto,
  EnergyProjectAnalysisPayloadDto,
  EnergyProjectAnalysisResolutionDto,
  EnergyProjectAnalysisSnapshotDto,
  EnergyProjectOverviewMinimumDto,
  EnergyPreschoolHtmlAiSlotReadModelDto,
  EnergyProjectHierarchyDto,
  EnergyProjectDto,
  EnergyPublishedProjectReleaseDto,
  EnergyQueryContextDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import { ConfigApiError, configApi } from "../../../lib/config-api";
import { buildEnergyTemplateRenderPlan } from "./energy-template-render-plan";
import * as ngeeAnnAiRun from "./ngee-ann-ai-run";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { resetPreschoolAiRunsForTests } from "./preschool-ai-run";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import {
  currentOverviewUrlWithView,
  currentOverviewAnalysisRequest,
  overviewAnalysisRequest,
  overviewUrlWithView,
  overviewViewStateFromSearchParams,
  preschoolSnapshotTransitionAdminHref,
  PublishedDecisionDashboard,
  toDateInput,
} from "./published-decision-dashboard";
import { applyProjectAnalysisQualityPolicy } from "./project-renderer-registry";

const mockedAccess = vi.hoisted(() => ({
  access: null as EnergyAccessContextDto | null,
  activeProject: null as EnergyProjectDto | null,
  selectProject: vi.fn<(projectId: string) => void>(),
}));
const mockedRouter = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>(),
}));

function acceptedPreschoolHtmlReadModel(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  identityOverride: { dataSnapshotId?: string; projectReleaseId?: string } = {},
): EnergyPreschoolHtmlAiSlotReadModelDto {
  const dataSnapshotId = identityOverride.dataSnapshotId ?? snapshot.context.dataSnapshotId;
  const projectReleaseId = identityOverride.projectReleaseId ?? snapshot.projectRelease.id;
  const sharedIdentity = {
    workspaceId: snapshot.context.workspaceId,
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId,
    projectReleaseId,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    reportTimePolicyId: "preschool-report-time",
    reportTimePolicyRevision: "2",
    reportTimeContextFingerprint: "preschool-report-time-fingerprint",
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
    promptRevision: "preschool-html-slot-prompt@15",
  };
  const slotDefinitionRevisions = Object.fromEntries(
    PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, `${slotId}@3`]),
  );
  const allowedEvidenceRefsBySlot = Object.fromEntries(
    PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, [`evidence:${slotId}`]]),
  );
  return {
    artifactKind: "preschool-html-ai-slot-read-model",
    status: "available",
    binding: {
      ...sharedIdentity,
      slotDefinitionRevisions,
      allowedEvidenceRefsBySlot,
    },
    slots: Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, {
      status: "available",
      artifact: {
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId,
        identity: {
          ...sharedIdentity,
          slotDefinitionRevision: slotDefinitionRevisions[slotId],
        },
        evidenceRefs: [`evidence:${slotId}`],
        accessibleText: `${slotId} accepted analysis`,
        html: `<article><h2>${slotId} accepted analysis</h2><p>Evidence-bound decision support.</p></article>`,
      },
      acceptance: { status: "accepted", droppedClaims: [] },
    }])),
  };
}

function missingPreschoolHtmlReadModel(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): EnergyPreschoolHtmlAiSlotReadModelDto {
  const accepted = acceptedPreschoolHtmlReadModel(snapshot);
  return {
    ...accepted,
    status: "missing",
    slots: Object.fromEntries(PRESCHOOL_HTML_AI_SLOT_IDS.map((slotId) => [slotId, { status: "missing" as const }])),
  };
}

describe("preschoolSnapshotTransitionAdminHref", () => {
  it("carries the exact current Overview B identity into the admin lab", () => {
    expect(preschoolSnapshotTransitionAdminHref({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-b",
      projectReleaseId: "release-b",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    })).toBe(
      "/energyiq/admin?section=ai-analysis&projectId=preschool-demo&abScopeId=preschool-project&abSnapshotId=snapshot-b&abReleaseId=release-b&abFrom=2026-06-01T00%3A00%3A00.000Z&abTo=2026-07-01T00%3A00%3A00.000Z",
    );
  });
});

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => mockedRouter,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => ({
    access: mockedAccess.access,
    activeProject: mockedAccess.activeProject,
    selectProject: mockedAccess.selectProject,
  }),
}));

describe("published Overview URL reload", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    mockedAccess.access = null;
    mockedAccess.activeProject = null;
    mockedAccess.selectProject.mockReset();
    mockedRouter.push.mockReset();
    mockedRouter.replace.mockReset();
    vi.spyOn(configApi, "getEnergyProjectHierarchy").mockResolvedValue(projectHierarchy());
    vi.spyOn(configApi, "getEnergyProjectOverviewMinimum")
      .mockRejectedValue(new Error("Minimum Overview not configured for this test."));
    vi.spyOn(configApi, "materializeCurrentProjectOverview").mockResolvedValue({
      changed: true,
      identity: {
        projectId: "test-project",
        dataSnapshotId: "test-snapshot",
        projectReleaseId: "test-release",
      },
      evidenceRefs: [],
    });
    const isolatedAiArtifact = {
      status: "failed" as const,
      dataSnapshotId: "test-snapshot",
      projectReleaseId: "test-release",
      attemptCount: 2,
      errorCode: "TEST_ARTIFACT_UNAVAILABLE",
    };
    // Keep component tests hermetic: the default client points at the local API
    // and must never create or retry a real Overview AI run from Happy DOM.
    vi.spyOn(configApi, "getEnergyOverviewAiArtifact").mockResolvedValue(isolatedAiArtifact);
    vi.spyOn(configApi, "ensureEnergyOverviewAiArtifact").mockResolvedValue(isolatedAiArtifact);
    vi.spyOn(configApi, "retryEnergyOverviewAiArtifact").mockResolvedValue(isolatedAiArtifact);
    vi.spyOn(configApi, "getEnergyProjectOverviewAiReadModel")
      .mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockReturnValue(new Promise<never>(() => undefined));
    ngeeAnnAiRun.resetNgeeAnnAiRunsForTests();
    resetPreschoolAiRunsForTests();
    vi.spyOn(ngeeAnnAiRun, "getOrStartNgeeAnnAiRun").mockResolvedValue({
      status: "unavailable",
      reason: "Test AI unavailable.",
    });
    window.history.replaceState({}, "", "/energyiq/overview");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("round-trips only the nine approved Fixed Golden URL fields", () => {
    const fixedUrl = "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all&dialog-open=true&focus=point-1";
    const view = overviewViewStateFromSearchParams(new URLSearchParams(fixedUrl));

    expect(view).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      grain: "day",
      comparison: "overlay",
      category: "all",
    });
    expect(overviewUrlWithView(view)).toBe(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("opens Project-scoped History over the Current Overview without dropping its URL context", async () => {
    const preschool = project("preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    vi.spyOn(configApi, "resolveProjectAnalysis").mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const history = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("History"));
    await act(async () => history?.click());

    expect(mockedRouter.push).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all&history=1",
    );
  });

  it("keeps hour grain only for a single-day Period and defaults invalid view controls safely", () => {
    const multiDay = overviewViewStateFromSearchParams(new URLSearchParams(
      "period=Last+7+days&grain=hour&comparison=unknown&category=unknown",
    ));
    const singleDay = overviewViewStateFromSearchParams(new URLSearchParams(
      "period=Custom&from=2026-06-16&to=2026-06-16&grain=hour&comparison=average&category=load",
    ));

    expect(multiDay).toMatchObject({ grain: "day", comparison: "overlay", category: "all" });
    expect(singleDay).toMatchObject({ grain: "hour", comparison: "average", category: "load" });
  });

  it("restores anomaly handoffs from URL and persists detail comparison controls", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=average&category=load",
    );
    const snapshot = dashboardNgeeAnnSnapshot();
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const explorer = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("View energy consumption"));
    const analyst = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("Ask the advisor"));
    const expectedQuery = "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=average&category=load";
    expect(explorer?.getAttribute("href")).toBe(
      `/energyiq/explorer?${expectedQuery}&dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}&projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    );
    expect(analyst?.getAttribute("href")).toBe(
      `/energyiq/ai?${expectedQuery}&dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}&projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    );

    const openIncident = container.querySelector<HTMLButtonElement>('button[data-anomaly-trigger="true"]');
    await act(async () => openIncident?.click());
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const average = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Comparable-day average");
    const selected = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Selected day");
    const load = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Load");
    const light = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Light");
    expect(average?.getAttribute("aria-pressed")).toBe("true");
    expect(load?.getAttribute("aria-pressed")).toBe("true");

    const navigationCountBeforeDetail = mockedRouter.replace.mock.calls.length;
    await act(async () => selected?.click());
    await act(async () => light?.click());
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    expect(light?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[role='dialog']")).toBe(dialog);
    const navigationCountAfterDetail = navigationCountBeforeDetail + 2;
    expect(mockedRouter.replace).toHaveBeenCalledTimes(navigationCountAfterDetail);

    const close = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Close");
    await act(async () => close?.click());

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(mockedRouter.replace).toHaveBeenCalledTimes(navigationCountAfterDetail);
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
  });

  it("uses the server-owned current Ngee Ann window without rendering global Period controls", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const snapshot = dashboardNgeeAnnSnapshot();
    snapshot.context.from = "2026-05-31T16:00:00.000Z";
    snapshot.context.to = "2026-06-16T16:00:00.000Z";
    snapshot.context.primaryPeriod = {
      start: snapshot.context.from,
      endExclusive: snapshot.context.to,
    };
    snapshot.dataSnapshot.sourceCoverage = {
      fromLocalDate: "2026-04-21",
      throughLocalDate: "2026-08-20",
    };
    snapshot.analysis.context.from = snapshot.context.from;
    snapshot.analysis.context.to = snapshot.context.to;
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };
    if (snapshot.analysis.dailyUsageAnomalies?.status === "available") {
      for (const scope of snapshot.analysis.dailyUsageAnomalies.scopes) {
        for (const row of scope.rows) {
          if (row.outcome === "triggered") row.outcome = "within_threshold";
        }
      }
    }
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });
    const saveEnergyAnalysis = vi.spyOn(configApi, "saveEnergyAnalysis")
      .mockRejectedValue(new Error("Expected test stop after request capture"));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(container.textContent).toContain("Decision themes unavailable");
    expect(container.textContent).toContain("Key Highlights");
    expect(container.textContent).toContain("Energy decision overview");
    expect(container.textContent).toContain("Calendar month to date");
    expect(container.textContent).toContain("1 Jun 2026–16 Jun 2026");
    expect(container.textContent).toContain("Report data through 16 Jun 2026");
    expect(container.textContent).toContain("Data available 21 Apr 2026–20 Aug 2026");
    expect(container.textContent).not.toContain("Published overview");
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(Array.from(container.querySelectorAll("button"), (button) => button.textContent)).not.toEqual(
      expect.arrayContaining(["Yesterday", "Last 7 days", "Previous week", "Previous month", "Custom"]),
    );
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
    const contents = container.querySelector("[aria-label='Overview contents']");
    expect(contents).not.toBeNull();
    expect(Array.from(contents?.querySelectorAll<HTMLAnchorElement>("a") ?? [], (anchor) => [
      anchor.textContent,
      anchor.getAttribute("href"),
    ])).toEqual([
      ["1 Management themes", "#ngee-ann-recommendations"],
      ["2 Executive Summary", "#ngee-ann-executive-summary"],
      ["3 Monthly context", "#ngee-ann-monthly-context"],
      ["4 AI interpretation", "#ngee-ann-ai-analysis"],
      ["5 Daily Total Trend", "#ngee-ann-daily-trend"],
      ["6 Supporting diagnostic index", "#ngee-ann-summary-findings"],
      ["7 Day Profile Analysis", "#ngee-ann-day-profile-analysis"],
      ["8 Time-based Behavioral Analysis", "#ngee-ann-energy-health"],
      ["9 Circuit Category Analysis", "#ngee-ann-circuit-analysis"],
      ["10 Evidence and calculation details", "#ngee-ann-evidence"],
    ]);
    expect(container.querySelector("#ngee-ann-recommendations-heading")?.getAttribute("data-overview-heading-number")).toBe("1");
    expect(container.querySelector("#ngee-ann-circuit-analysis-heading")?.getAttribute("data-overview-heading-number")).toBe("9");
    for (const anchor of Array.from(contents?.querySelectorAll<HTMLAnchorElement>("a") ?? [])) {
      expect(container.querySelector(anchor.getAttribute("href")!)).not.toBeNull();
    }
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    const explorer = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("View energy consumption"));
    expect(explorer?.getAttribute("href")).toContain("period=Custom&from=2026-06-01&to=2026-06-16");
    expect(explorer?.getAttribute("href")).toContain(`dataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`);
    expect(explorer?.getAttribute("href")).toContain(`projectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`);
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save analysis");
    await act(async () => save?.click());
    expect(saveEnergyAnalysis).toHaveBeenCalledWith(
      "ngee-ann-polytechnic",
      expect.objectContaining({
      analysisWindow: "current-project-overview",
        from: "2026-06-01",
        to: "2026-06-16",
        expectedDataSnapshotId: snapshot.context.dataSnapshotId,
        expectedProjectReleaseId: snapshot.projectRelease.id,
        viewState: {
          grain: "day",
          comparison: "overlay",
          category: "all",
        },
      }),
    );
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      `currentDataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`,
    ), { scroll: false });
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      `currentProjectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    ), { scroll: false });
  });

  it("normalizes a legacy Ngee Ann Custom deep link to the current Project overview", async () => {
    window.history.replaceState({}, "", "/energyiq/overview?scopeId=level-7&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).not.toHaveBeenCalled();

    mockedAccess.activeProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
  });

  it("reuses the exact cache on Refresh and reserves recomputation for an explicit admin action", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = { ...accessContext([preschool]), role: "admin" };
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&grain=day&comparison=overlay&category=all",
    );
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    expect(container.querySelector("[data-preschool-overview='true']")).not.toBeNull();
    expect(container.textContent?.match(/Energy overview/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("Portfolio energy overview");
    expect(container.textContent).not.toContain("Published overview");
    expect(container.textContent).not.toContain("A Project-wide portfolio view built from");
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(container.querySelector("[aria-label='Area and headcount metadata']")).toBeNull();
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
    const centreExplorerLink = container.querySelector<HTMLAnchorElement>("[data-centre-explorer-link]");
    expect(centreExplorerLink).not.toBeNull();
    const linkedScopeId = centreExplorerLink!.dataset.centreExplorerLink;
    expect(linkedScopeId).toBeTruthy();
    const centreExplorerUrl = new URL(centreExplorerLink!.href);
    expect(Object.fromEntries(centreExplorerUrl.searchParams)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: linkedScopeId,
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
    expect(container.textContent).toContain("Overview contents");
    const contents = container.querySelector("[aria-label='Overview contents']");
    const contentLinks = Array.from(contents?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    expect(contentLinks.map((anchor) => [anchor.textContent, anchor.getAttribute("href")])).toEqual([
      ["1 Overview", "#preschool-overall-summary"],
      ["1.1 At a glance", "#preschool-decision-summary"],
      ["1.2 AI interpretation", "#preschool-ai-analysis"],
      ["2 Benchmarks", "#preschool-benchmark-analysis"],
      ["2.1 Centre efficiency metrics", "#preschool-centre-efficiency-metrics"],
      ["2.2 EUI Benchmark", "#preschool-eui-benchmark"],
      ["2.3 Per-pax Energy Benchmark", "#preschool-per-pax-benchmark"],
      ["3 Standby wastage", "#preschool-standby-wastage"],
      ["3.1 Standby energy by appliance", "#preschool-standby-appliances"],
      ["3.2 Non-operating hours spikes", "#preschool-standby-spikes"],
      ["3.3 After-hours Review Priority", "#preschool-after-hours-review"],
      ["4 Operating hours", "#preschool-operating-hours"],
      ["4.1 Operating energy by appliance", "#preschool-operating-appliances"],
      ["4.2 Operating hours spikes", "#preschool-operating-spikes"],
      ["5 Monthly outlook", "#preschool-monthly-outlook"],
      ["6 Centre detail", "#preschool-centre-ranking"],
      ["7 Supporting evidence", "#preschool-evidence"],
    ]);
    expect(container.querySelector("#preschool-overall-summary-heading")?.getAttribute("data-overview-heading-number")).toBe("1");
    expect(container.querySelector("#preschool-standby-spikes-heading")?.getAttribute("data-overview-heading-number")).toBe("3.2");
    for (const anchor of contentLinks) {
      const href = anchor.getAttribute("href");
      expect(href).toMatch(/^#preschool-/);
      expect(container.querySelector(href!)).not.toBeNull();
    }
    expect(Array.from(container.querySelectorAll("button"), (button) => button.textContent)).not.toEqual(
      expect.arrayContaining(["Yesterday", "Last 7 days", "Previous week", "Previous month", "Custom"]),
    );
    expect(Array.from(
      container.querySelector("[aria-label='Resource type']")?.querySelectorAll("button") ?? [],
      (button) => button.textContent,
    )).toEqual(["Electricity"]);
    expect(container.textContent).toContain("Refresh current overview");
    expect(container.textContent).toContain("Save analysis");
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      `currentDataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`,
    ), { scroll: false });
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      `currentProjectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    ), { scroll: false });

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => refresh?.click());

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(2, {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });

    const recompute = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Recompute overview");
    expect(recompute).toBeDefined();
    await act(async () => recompute?.click());

    expect(configApi.materializeCurrentProjectOverview).toHaveBeenCalledWith("preschool-demo");
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(3);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(3, {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
  });

  it("keeps production HTML presentation on structured Slots while all server Slots are missing", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = { ...accessContext([preschool]), role: "admin" };
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&aiPresentation=html",
    );
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    const htmlSlotsRead = vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockReturnValue(new Promise<never>(() => undefined));
    const htmlSlotsGenerate = vi.spyOn(configApi, "generateEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(missingPreschoolHtmlReadModel(snapshot));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(htmlSlotsRead).toHaveBeenCalledWith(
      "preschool-demo",
      "preschool-project",
      expect.objectContaining({
        dataSnapshotId: snapshot.context.dataSnapshotId,
        projectReleaseId: snapshot.projectRelease.id,
      }),
    );
    expect(container.querySelector("[data-ai-presentation-preview='true']")).toBeNull();
    expect(container.textContent).not.toContain("not DeepSeek or GPT model output");
    expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
    expect(container.querySelector("[data-preschool-overview='true']")).not.toBeNull();
    expect(container.textContent).not.toContain("HTML AI Slot prototype preview");

    expect(htmlSlotsGenerate).not.toHaveBeenCalled();
  });

  it("renders six accepted exact HTML Slots on the ordinary Preschool Overview route", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    const htmlSlotsRead = vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(acceptedPreschoolHtmlReadModel(snapshot));
    const generateHtmlSlots = vi.spyOn(configApi, "generateEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(acceptedPreschoolHtmlReadModel(snapshot));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(htmlSlotsRead).toHaveBeenCalledWith(
      "preschool-demo",
      "preschool-project",
      expect.objectContaining({
        dataSnapshotId: snapshot.context.dataSnapshotId,
        projectReleaseId: snapshot.projectRelease.id,
      }),
    );
    await vi.waitFor(() => {
      expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(6);
    });
    expect(configApi.ensureEnergyOverviewAiArtifact).not.toHaveBeenCalled();
    expect(generateHtmlSlots).not.toHaveBeenCalled();
    expect(container.querySelector("[data-ai-presentation-preview='true']")).toBeNull();
    expect(container.querySelector("[data-preschool-overview='true']")).not.toBeNull();
  });

  it("honours the immutable Release rollback switch even when accepted HTML exists", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    snapshot.projectRelease.renderer.aiPresentationMode = "structured";
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    const htmlSlotsRead = vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(acceptedPreschoolHtmlReadModel(snapshot));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(htmlSlotsRead).not.toHaveBeenCalled();
    expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
    expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
  });

  it("keeps the default structured Slots when the HTML read model has a foreign Snapshot identity", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(acceptedPreschoolHtmlReadModel(snapshot, { dataSnapshotId: "snapshot-from-another-report" }));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
      expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
    });
  });

  it("keeps every structured Slot when the exact HTML artifact set is incomplete", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    const incomplete = acceptedPreschoolHtmlReadModel(snapshot);
    incomplete.slots["additional-insight"] = { status: "missing" };
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots").mockResolvedValue(incomplete);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
      expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
    });
  });

  it("keeps every structured Slot when one exact HTML artifact fails client acceptance", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    const rejected = acceptedPreschoolHtmlReadModel(snapshot);
    const rejectedSlot = rejected.slots["centre-benchmark"];
    if (rejectedSlot?.artifact) {
      rejectedSlot.artifact.evidenceRefs = ["evidence:not-allowed-for-centre-benchmark"];
    }
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots").mockResolvedValue(rejected);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
      expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
    });
  });

  it("keeps every structured Slot when no accepted HTML artifact set exists", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(missingPreschoolHtmlReadModel(snapshot));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
      expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
    });
  });

  it("renders the clearly marked six-slot preview only for the explicit html-preview entry", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = { ...accessContext([preschool]), role: "admin" };
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo&aiPresentation=html-preview");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockResolvedValue(missingPreschoolHtmlReadModel(snapshot));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-ai-presentation-preview='true']")).not.toBeNull();
    expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(6);
    expect(container.textContent).toContain("not DeepSeek or GPT model output");
  });

  it("revalidates the server-owned HTML Slot binding after focus", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo&aiPresentation=html");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    const complete = acceptedPreschoolHtmlReadModel(snapshot);
    const missing = missingPreschoolHtmlReadModel(snapshot);
    const htmlSlotsRead = vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockResolvedValueOnce(missing)
      .mockResolvedValueOnce(complete);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(htmlSlotsRead).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(htmlSlotsRead).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(6));
    expect(container.querySelector("[data-ai-presentation-preview='true']")).toBeNull();

    htmlSlotsRead.mockRejectedValueOnce(new Error("revalidation unavailable"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
      expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
    });
  });

  it("falls back to the structured Slot when the HTML Artifact read fails", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&aiPresentation=html",
    );
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    vi.spyOn(configApi, "getEnergyPreschoolHtmlAiSlots")
      .mockRejectedValue(new Error("HTML artifact read unavailable"));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-ai-presentation-preview='true']")).toBeNull();
    expect(container.querySelectorAll("iframe[data-ai-slot-html]")).toHaveLength(0);
    expect(container.querySelector("#preschool-ai-analysis")).not.toBeNull();
    expect(container.textContent).not.toContain("HTML AI Slot prototype preview");
  });

  it("shows the deterministic Preschool Overview while AI restore is pending and never starts AI on hard remount", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&grain=day&comparison=overlay&category=all",
    );
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({ status: "ready", snapshot });
    type OverviewAiArtifact = Awaited<ReturnType<typeof configApi.getEnergyOverviewAiArtifact>>;
    let resolveAiRestore!: (artifact: OverviewAiArtifact) => void;
    const deferredAiRestore = new Promise<OverviewAiArtifact>((resolve) => {
      resolveAiRestore = resolve;
    });
    const readSpy = vi.mocked(configApi.getEnergyOverviewAiArtifact).mockReturnValue(deferredAiRestore);
    const ensureSpy = vi.mocked(configApi.ensureEnergyOverviewAiArtifact);
    const retrySpy = vi.mocked(configApi.retryEnergyOverviewAiArtifact);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(container.textContent).toContain("Overall metrics");
    expect(container.textContent).toContain("At a glance");
    for (const sectionId of [
      "preschool-benchmark-analysis",
      "preschool-standby-wastage",
      "preschool-operating-hours",
      "preschool-monthly-outlook",
    ]) expect(container.querySelector(`#${sectionId}`)).not.toBeNull();
    expect(container.textContent).toContain("Loading saved AI summary…");

    await act(async () => {
      resolveAiRestore({
        status: "missing",
        dataSnapshotId: snapshot.context.dataSnapshotId,
        projectReleaseId: snapshot.projectRelease.id,
      });
      await Promise.resolve();
    });

    readSpy.mockResolvedValue({
      status: "missing",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => {
      refresh?.click();
      await Promise.resolve();
    });
    expect(readSpy).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    root = createRoot(container);
    resetPreschoolAiRunsForTests();
    readSpy.mockResolvedValue({
      status: "missing",
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    });
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Overall metrics");
    expect(container.textContent).toContain("At a glance");
    expect(readSpy).toHaveBeenCalledTimes(3);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(retrySpy).not.toHaveBeenCalled();
  });

  it("renders the immutable Overview before targeted lifecycle and keeps it when lifecycle fails", async () => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({
      status: "ready",
      snapshot,
      overviewContext: {
        contract: "energyiq-overview-context-reference@1",
        projectionRef: "sha256:preschool-current",
        identity: {},
        evidenceRefs: [],
      },
    });
    let rejectLifecycle!: (reason: Error) => void;
    const lifecycle = new Promise<never>((_resolve, reject) => {
      rejectLifecycle = reject;
    });
    const lifecycleSpy = vi.spyOn(configApi, "getCurrentProjectOverviewLifecycle")
      .mockReturnValue(lifecycle);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Overall metrics");
    expect(lifecycleSpy).toHaveBeenCalledWith("preschool-demo", "sha256:preschool-current");

    await act(async () => {
      rejectLifecycle(new Error("targeted lifecycle unavailable"));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Overall metrics");
  });

  it("merges targeted lifecycle only when it matches the mounted immutable projection ref", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic");
    const snapshot = dashboardNgeeAnnSnapshot();
    const decisionLifecycle = snapshot.decisionLifecycle!;
    delete snapshot.decisionLifecycle;
    vi.spyOn(configApi, "resolveProjectAnalysis").mockResolvedValue({
      status: "ready",
      snapshot,
      overviewContext: {
        contract: "energyiq-overview-context-reference@1",
        projectionRef: "sha256:ngee-current",
        identity: {},
        evidenceRefs: [],
      },
    });
    vi.spyOn(configApi, "getCurrentProjectOverviewLifecycle").mockResolvedValue({
      contract: "energyiq-overview-lifecycle@1",
      projectionRef: "sha256:ngee-current",
      observedAt: "2026-08-27T00:00:00.000Z",
      inputFingerprint: "saved-state-a",
      decisionLifecycle,
    });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Newly supported in current B");
  });

  it("refreshes targeted lifecycle only after the refreshed immutable Overview is accepted", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic");
    const snapshot = dashboardNgeeAnnSnapshot();
    delete snapshot.decisionLifecycle;
    const ready = {
      status: "ready" as const,
      snapshot,
      overviewContext: {
        contract: "energyiq-overview-context-reference@1" as const,
        projectionRef: "sha256:ngee-current",
        identity: {},
        evidenceRefs: [],
      },
    };
    let finishRefresh!: (value: typeof ready) => void;
    const refreshResult = new Promise<typeof ready>((resolve) => {
      finishRefresh = resolve;
    });
    const resolutionSpy = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce(ready)
      .mockReturnValueOnce(refreshResult);
    const lifecycleSpy = vi.spyOn(configApi, "getCurrentProjectOverviewLifecycle")
      .mockResolvedValue({
        contract: "energyiq-overview-lifecycle@1",
        projectionRef: "sha256:ngee-current",
        observedAt: "2026-08-27T00:00:00.000Z",
        inputFingerprint: "saved-state-a",
      });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });
    expect(lifecycleSpy).toHaveBeenCalledOnce();

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => {
      refresh?.click();
      await Promise.resolve();
    });
    expect(resolutionSpy).toHaveBeenCalledTimes(2);
    expect(lifecycleSpy).toHaveBeenCalledOnce();

    await act(async () => {
      finishRefresh(ready);
      await Promise.resolve();
    });
    expect(lifecycleSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a URL without Period", "/energyiq/overview?projectId=preschool-demo&scopeId=level-7&resource=electricity"],
    ["an old arbitrary Custom range", "/energyiq/overview?projectId=preschool-demo&scopeId=level-7&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16"],
    ["an old Water resource", "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=water&period=Custom&from=2026-05-01&to=2026-05-31"],
  ] as const)("resolves legacy Preschool %s through the server-owned current window", async (_label, href) => {
    const preschool = project("preschool-demo", "Preschool Portfolio");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", href);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    for (const [nextHref] of mockedRouter.replace.mock.calls) {
      expect(nextHref).not.toContain("period=Custom");
      expect(nextHref).not.toContain("from=2026-05-01");
      expect(nextHref).not.toContain("to=2026-05-31");
    }
    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(container.querySelectorAll("input[type='date']")).toHaveLength(0);
    expect(configApi.getEnergyProjectHierarchy).not.toHaveBeenCalled();
  });

  it.each([
    ["Previous week", "Previous+week"],
    ["Previous month", "Previous+month"],
  ] as const)("uses a cold public %s URL for the first resolve after access hydration", async (period, encodedPeriod) => {
    window.history.replaceState(
      {},
      "",
      `/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=${encodedPeriod}`,
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).not.toHaveBeenCalled();

    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period,
    });
  });

  it("atomically resolves new Custom dates after client navigation changes the public URL", async () => {
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-01&to=2026-06-07");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-01",
      to: "2026-06-07",
    });

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10&to=2026-06-16");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
    expect(Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"), (input) => input.value))
      .toEqual(["2026-06-10", "2026-06-16"]);
  });

  it("does not resolve an incomplete Custom URL and explains which dates are required", async () => {
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("Choose both From and To dates for a Custom period.");
  });

  it("does not resolve a reversed Custom URL and explains the accepted date order", async () => {
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-16&to=2026-06-10");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("From date must be on or before To date.");
  });

  it("does not resolve invalid Custom URL dates", async () => {
    mockedAccess.activeProject = project("generic-demo", "Generic Project");
    window.history.replaceState({}, "", "/energyiq/overview?period=Custom&from=2026-06-10&to=not-a-date");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("Use valid Custom dates in YYYY-MM-DD format.");
  });

  it("uses an authorized published URL Project and Scope before the different active Project", async () => {
    const preschool = project("generic-demo", "Generic Project");
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool, ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=level-6&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    expect(mockedAccess.selectProject).toHaveBeenCalledOnce();
    expect(mockedAccess.selectProject).toHaveBeenCalledWith("ngee-ann-polytechnic");
    expect(container.textContent).toContain("Ngee Ann Polytechnic");
    expect(container.textContent).not.toContain("Generic Project");
  });

  it("does not fall back to the active Project when the URL Project is unavailable", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=unknown-project&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Requested Project is unavailable in the active workspace.");
    expect(container.textContent).not.toContain("Generic Project");
  });

  it("rejects a published URL Project outside the active workspace", async () => {
    const preschool = project("generic-demo", "Generic Project");
    const otherWorkspaceProject = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic", "workspace-2");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool, otherWorkspaceProject]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(mockedAccess.selectProject).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("Requested Project is unavailable in the active workspace.");
  });

  it("normalizes a legacy Ngee Ann Water URL to the electricity-only current Overview", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic&resource=water&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const resourceButtons = Array.from(
      container.querySelector("[aria-label='Resource type']")?.querySelectorAll("button") ?? [],
      (button) => button.textContent,
    );
    expect(resourceButtons).toEqual(["Electricity"]);
    expect(container.textContent).not.toContain("Water analysis is not configured");
  });

  it("writes a Resource change to the public URL without losing the current view", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const resourceButtons = Array.from(
      container.querySelector("[aria-label='Resource type']")?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    expect(resourceButtons.map((button) => button.textContent)).toEqual(["Electricity", "Water"]);
    const water = resourceButtons.find((button) => button.textContent === "Water");
    await act(async () => water?.click());

    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("composes consecutive Resource and Period changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const water = buttons.find((button) => button.textContent === "Water");
    const lastSevenDays = buttons.find((button) => button.textContent === "Last 7 days");
    await act(async () => water?.click());
    await act(async () => lastSevenDays?.click());

    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Last+7+days&grain=day&comparison=overlay&category=all",
    ]);
  });

  it("writes Period changes to the public URL with only the effective date range", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const periodButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const lastSevenDays = periodButtons.find((button) => button.textContent === "Last 7 days");
    const yesterday = periodButtons.find((button) => button.textContent === "Yesterday");
    const custom = periodButtons.find((button) => button.textContent === "Custom");
    await act(async () => lastSevenDays?.click());
    await act(async () => yesterday?.click());
    await act(async () => custom?.click());

    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Last+7+days&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Yesterday&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    ]);
  });

  it("selects and restores Previous week through the server-authoritative URL contract", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousWeek = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous week");
    await act(async () => previousWeek?.click());
    const previousWeekUrl = "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenCalledWith(previousWeekUrl);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousWeekUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Previous week",
    });
  });

  it("selects and restores Previous month through the server-authoritative URL contract", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousMonth = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous month");
    await act(async () => previousMonth?.click());
    const previousMonthUrl = "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+month&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenCalledWith(previousMonthUrl);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousMonthUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Previous month",
    });
  });

  it("preserves Previous week when Scope changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Last%207%20days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousWeek = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous week");
    await act(async () => previousWeek?.click());
    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const totalCircuit = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.endsWith("Level 6 / Total Office Load"));
    await act(async () => totalCircuit?.click());

    const previousWeekScopeUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Previous+week&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week&grain=day&comparison=overlay&category=all",
      previousWeekScopeUrl,
    ]);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousWeekScopeUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Previous week",
    });
  });

  it("preserves Previous month when Scope changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+week");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const previousMonth = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Previous month");
    await act(async () => previousMonth?.click());
    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const totalCircuit = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent?.endsWith("Level 6 / Total Office Load"));
    await act(async () => totalCircuit?.click());

    const previousMonthScopeUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Previous+month&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Previous+month&grain=day&comparison=overlay&category=all",
      previousMonthScopeUrl,
    ]);

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", previousMonthScopeUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Previous month",
    });
  });

  it.each(["Previous week", "Previous month"] as const)(
    "keeps ready zero-coverage %s explicit without auto-navigation or a second resolve",
    async (period) => {
      const preschool = project("generic-demo", "Generic Project");
      mockedAccess.activeProject = preschool;
      mockedAccess.access = accessContext([preschool]);
      const periodUrl = `/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=${period.replace(" ", "+")}`;
      window.history.replaceState({}, "", periodUrl);
      const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockResolvedValue(readyZeroCoverageResolution(period));

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
      });

      expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
      expect(resolveProjectAnalysis).toHaveBeenCalledWith({
        projectId: "generic-demo",
        scopeId: "project",
        resource: "electricity",
        period,
      });
      expect(mockedRouter.replace).not.toHaveBeenCalled();
      expect(window.location.pathname + window.location.search).toBe(periodUrl);
      expect(container.textContent).toContain("Unavailable");
      expect(container.textContent).toContain("0% coverage");
    },
  );

  it("keeps the canonical current cutoff when a selected Scope has no accepted facts", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const defaultUrl = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity";
    window.history.replaceState({}, "", defaultUrl);
    const zeroCoverage = readyZeroCoverageResolution("Last 7 days");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue(zeroCoverage);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    expect(mockedRouter.replace).toHaveBeenCalledWith(expect.stringContaining(
      "currentFrom=2026-07-28&currentTo=2026-08-03",
    ), { scroll: false });
    expect(window.location.pathname + window.location.search).toBe(defaultUrl);
    const latestButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("View latest available data"));
    expect(latestButton).toBeFalsy();
    expect(mockedRouter.replace).toHaveBeenCalledOnce();
  });

  it("carries the server-resolved range when a standard Period changes to Custom", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Last%207%20days");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue(readyRangeResolution());

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const custom = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Custom");
    await act(async () => custom?.click());

    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("writes each Custom date to the public URL before resolving the rerendered view", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    const initialUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16";
    window.history.replaceState({}, "", initialUrl);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    resolveProjectAnalysis.mockClear();

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const [initialFrom] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"));
    await act(async () => {
      inputValueSetter?.call(initialFrom, "2026-06-11");
      initialFrom.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const fromUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-16&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenLastCalledWith(fromUrl);
    window.history.replaceState({}, "", fromUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-11",
      to: "2026-06-16",
    });

    mockedRouter.replace.mockClear();
    resolveProjectAnalysis.mockClear();
    const [, rerenderedTo] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"));
    await act(async () => {
      inputValueSetter?.call(rerenderedTo, "2026-06-17");
      rerenderedTo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const toUrl = "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-17&grain=day&comparison=overlay&category=all";
    expect(mockedRouter.replace).toHaveBeenLastCalledWith(toUrl);
    window.history.replaceState({}, "", toUrl);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-11",
      to: "2026-06-17",
    });
  });

  it("composes consecutive Custom date changes before the router rerenders", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const [fromInput, toInput] = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='date']"));
    await act(async () => {
      inputValueSetter?.call(fromInput, "2026-06-11");
      fromInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      inputValueSetter?.call(toInput, "2026-06-17");
      toInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(mockedRouter.replace.mock.calls.map(([href]) => href)).toEqual([
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-16&grain=day&comparison=overlay&category=all",
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-11&to=2026-06-17&grain=day&comparison=overlay&category=all",
    ]);
  });

  it("switches from Project to a published hierarchy Scope through the public URL", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    expect(scopeSelect).not.toBeNull();
    await act(async () => scopeSelect?.click());
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"));
    expect(options.map((option) => option.textContent)).toEqual([
      "Project · Generic Project",
      "Level · Level 6",
      "Circuit · Level 6 / L6 Light Left",
      "Circuit · Level 6 / Total Office Load",
      "Level · Level 7",
      "Circuit · Level 7 / Total Office Load",
    ]);

    const totalCircuit = options.find((option) => option.textContent === "Circuit · Level 6 / Total Office Load");
    await act(async () => totalCircuit?.click());
    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );

    resolveProjectAnalysis.mockClear();
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
    expect(resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "generic-demo",
      scopeId: "l6-total-light",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
    });
  });

  it("bounds Scope display paths when hierarchy parents are missing or cyclic", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    const malformedHierarchy = projectHierarchy();
    malformedHierarchy.nodes.push(
      {
        id: "orphan-circuit",
        project_id: "ngee-ann-polytechnic",
        parent_id: "missing-level",
        name: "Orphan Circuit",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 3,
        metadata_status: "provisional",
      },
      {
        id: "cycle-a",
        project_id: "ngee-ann-polytechnic",
        parent_id: "cycle-b",
        name: "Cycle A",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 4,
        metadata_status: "provisional",
      },
      {
        id: "cycle-b",
        project_id: "ngee-ann-polytechnic",
        parent_id: "cycle-a",
        name: "Cycle B",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 5,
        metadata_status: "provisional",
      },
    );
    vi.mocked(configApi.getEnergyProjectHierarchy).mockResolvedValue(malformedHierarchy);
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const labels = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"), (option) => option.textContent);
    expect(labels).toContain("Circuit · Orphan Circuit");
    expect(labels).toContain("Circuit · Cycle B / Cycle A");
    expect(labels).toContain("Circuit · Cycle A / Cycle B");
  });

  it("preserves the URL-backed resource, period and Custom range when Scope changes", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=water&period=Custom&from=2026-06-10&to=2026-06-16");
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).not.toHaveBeenCalled();

    const scopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    await act(async () => scopeSelect?.click());
    const totalCircuit = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
      .find((option) => option.textContent === "Circuit · Level 6 / Total Office Load");
    await act(async () => totalCircuit?.click());

    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      "/energyiq/overview?projectId=generic-demo&scopeId=l6-total-light&resource=water&period=Custom&from=2026-06-10&to=2026-06-16&grain=day&comparison=overlay&category=all",
    );
  });

  it("shows a disabled Scope selector when hierarchy loading fails and retries on Refresh", async () => {
    const preschool = project("generic-demo", "Generic Project");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=generic-demo&scopeId=project&resource=electricity&period=Last%207%20days");
    const loadHierarchy = vi.mocked(configApi.getEnergyProjectHierarchy)
      .mockRejectedValueOnce(new Error("Hierarchy service unavailable"))
      .mockResolvedValue(projectHierarchy());
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new Error("Analysis service unavailable"));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    const failedScopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    expect(failedScopeSelect?.disabled).toBe(true);
    expect(container.textContent).toContain("Analysis scopes unavailable: Hierarchy service unavailable");
    expect(loadHierarchy).toHaveBeenCalledTimes(1);

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh view");
    expect(refresh?.disabled).toBe(false);
    await act(async () => refresh?.click());

    expect(loadHierarchy).toHaveBeenCalledTimes(2);
    const restoredScopeSelect = container.querySelector<HTMLButtonElement>("[role='combobox'][aria-label='Analysis Scope']");
    expect(restoredScopeSelect?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Analysis scopes unavailable");
  });

  it.each([
    ["ENERGYIQ_DATA_SNAPSHOT_MISMATCH", "CONFLICT", 409],
    ["ENERGYIQ_PROJECT_RELEASE_MISMATCH", "CONFLICT", 409],
    ["ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH", "INTERNAL_ERROR", 500],
  ] as const)("silently recovers one exact stale current pin (%s) through the latest authorized Overview", async (errorCode, apiCode, status) => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=level-7&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1",
    );
    const snapshot = dashboardNgeeAnnSnapshot();
    const minimum = overviewMinimum(snapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    vi.mocked(configApi.getEnergyProjectOverviewMinimum)
      .mockRejectedValueOnce(new Error("Minimum unavailable during the stale read."))
      .mockResolvedValueOnce(minimum);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValueOnce(new ConfigApiError(
        apiCode,
        errorCode,
        status,
      ));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      scopeId: "project",
      analysisWindow: "current-project-overview",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "stale-snapshot",
      expectedProjectReleaseId: "release-v1",
    }));
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain(errorCode);
    expect(container.textContent).not.toContain("Published analysis is unavailable");

    expect(mockedRouter.replace).toHaveBeenCalledOnce();
    const [freshHref, options] = mockedRouter.replace.mock.calls[0]!;
    expect(freshHref).toContain(`currentDataSnapshotId=${encodeURIComponent(minimum.binding.currentPin.dataSnapshotId)}`);
    expect(freshHref).toContain(`currentProjectReleaseId=${encodeURIComponent(minimum.binding.currentPin.projectReleaseId)}`);
    expect(freshHref).not.toContain("stale-snapshot");
    expect(options).toEqual({ scroll: false });
    expect(configApi.ensureEnergyOverviewAiArtifact).not.toHaveBeenCalled();
    expect(configApi.retryEnergyOverviewAiArtifact).not.toHaveBeenCalled();
  });

  it("allows a new automatic recovery when the user later re-enters the same stale current link", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const staleHref = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1";
    const snapshot = dashboardNgeeAnnSnapshot();
    const minimum = overviewMinimum(snapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    window.history.replaceState({}, "", staleHref);
    vi.mocked(configApi.getEnergyProjectOverviewMinimum)
      .mockRejectedValueOnce(new Error("Minimum unavailable during the first stale read."))
      .mockResolvedValueOnce(minimum)
      .mockRejectedValueOnce(new Error("Minimum unavailable during the exact read."))
      .mockRejectedValueOnce(new Error("Minimum unavailable during the second stale read."))
      .mockResolvedValueOnce(minimum);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValueOnce(new ConfigApiError(
        "CONFLICT",
        "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        409,
      ))
      .mockResolvedValueOnce({ status: "ready", snapshot })
      .mockRejectedValueOnce(new ConfigApiError(
        "CONFLICT",
        "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        409,
      ));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    const firstRecoveredHref = mockedRouter.replace.mock.calls.at(-1)?.[0];
    expect(firstRecoveredHref).toContain(`currentDataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}`);

    window.history.replaceState({}, "", firstRecoveredHref!);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);

    window.history.replaceState({}, "", staleHref);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(3);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(3, expect.objectContaining({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
      expectedDataSnapshotId: "stale-snapshot",
      expectedProjectReleaseId: "release-v1",
    }));
    expect(mockedRouter.replace).toHaveBeenCalledTimes(2);
    expect(configApi.ensureEnergyOverviewAiArtifact).not.toHaveBeenCalled();
    expect(configApi.retryEnergyOverviewAiArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
  ] as const)("never treats an authenticated %s response as a recoverable current pin", async (apiCode, status) => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1",
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new ConfigApiError(
        apiCode,
        "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        status,
      ));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
    expect(container.textContent).not.toContain("Updating to the latest report…");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("stops after one failed automatic recovery for the same current report identity", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const staleHref = "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1";
    window.history.replaceState({}, "", staleHref);
    vi.mocked(configApi.getEnergyProjectOverviewMinimum)
      .mockRejectedValue(new ConfigApiError(
        "INTERNAL_ERROR",
        "Latest report resolution failed",
        500,
      ));
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValueOnce(new ConfigApiError(
        "CONFLICT",
        "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        409,
      ))
      .mockRejectedValue(new ConfigApiError(
        "CONFLICT",
        "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        409,
      ));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Current overview is temporarily unavailable.");
    expect(container.textContent).not.toContain("Latest report resolution failed");
    expect(container.textContent).not.toContain("Updating to the latest report…");
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    expect(retry).not.toBeUndefined();

    window.history.replaceState({}, "", `${staleHref}&focus=unchanged-report`);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(configApi.ensureEnergyOverviewAiArtifact).not.toHaveBeenCalled();
    expect(configApi.retryEnergyOverviewAiArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ["CONFLICT", "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE", 409],
    ["CONFLICT", "ENERGYIQ_DATA_SNAPSHOT_MISMATCH:stale-snapshot", 409],
    ["BAD_REQUEST", "ENERGYIQ_TARIFF_REVISION_REQUIRED", 400],
  ] as const)("keeps non-allowlisted resolver errors visible (%s %s)", async (apiCode, message, status) => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1",
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new ConfigApiError(apiCode, message, status));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toContain("Updating to the latest report…");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["History", "history=1"],
    ["Saved Analysis", "history=1&savedAnalysisId=saved-analysis-a"],
  ] as const)("keeps a stale current pin frozen behind %s", async (_label, frozenQuery) => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      `/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=stale-snapshot&currentProjectReleaseId=release-v1&${frozenQuery}`,
    );
    vi.spyOn(configApi, "listEnergySavedAnalyses").mockResolvedValue({ items: [] });
    vi.spyOn(configApi, "getEnergySavedAnalysis").mockReturnValue(new Promise<never>(() => undefined));
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new ConfigApiError(
        "CONFLICT",
        "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        409,
      ));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Updating to the latest report…");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("fails closed before resolution when a current Overview pin is incomplete", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&currentFrom=2026-05-20&currentDataSnapshotId=stale-snapshot",
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Current Overview link has an incomplete report identity.");
    expect(container.textContent).not.toContain("Updating to the latest report…");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("consumes a user-triggered current Overview refresh only once when the router rerenders the same URL", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const snapshot = dashboardNgeeAnnSnapshot();
    window.history.replaceState(
      {},
      "",
      `/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all&currentFrom=2026-06-01&currentTo=2026-06-16&currentDataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}&currentProjectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => refresh?.click());
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(resolveProjectAnalysis).toHaveBeenLastCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
  });

  it("keeps the resolved Overview mounted when its trusted current pin is written to the URL", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const snapshot = dashboardNgeeAnnSnapshot();
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValue({ status: "ready", snapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

    const pinnedHref = mockedRouter.replace.mock.calls
      .map(([href]) => href)
      .find((href) => href.includes("currentDataSnapshotId="));
    expect(pinnedHref).toBeTruthy();
    window.history.replaceState({}, "", pinnedHref!);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    expect(container.textContent).not.toContain("Resolving the published analysis");
  });

  it("keeps the current Overview visible while a user refresh is pending", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    const snapshot = dashboardNgeeAnnSnapshot();
    window.history.replaceState(
      {},
      "",
      `/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all&currentFrom=2026-06-10&currentTo=2026-06-16&currentDataSnapshotId=${encodeURIComponent(snapshot.context.dataSnapshotId)}&currentProjectReleaseId=${encodeURIComponent(snapshot.projectRelease.id)}`,
    );
    let finishRefresh!: (resolution: EnergyProjectAnalysisResolutionDto) => void;
    const refreshResolution = new Promise<EnergyProjectAnalysisResolutionDto>((resolve) => {
      finishRefresh = resolve;
    });
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot })
      .mockReturnValueOnce(refreshResolution);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => refresh?.click());

    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    expect(container.textContent).toContain("Refreshing…");
    expect(container.textContent).not.toContain("Resolving the published analysis");

    await act(async () => {
      finishRefresh({ status: "ready", snapshot });
      await Promise.resolve();
    });
  });

  it("keeps the previous Project Overview usable until a slow workspace target is ready", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    const preschool = project("preschool-demo", "Preschool Demo", "preschool-demo-org");
    const ngeeSnapshot = dashboardNgeeAnnSnapshot();
    const preschoolSnapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    let finishProjectSwitch!: (resolution: EnergyProjectAnalysisResolutionDto) => void;
    const pendingProjectSwitch = new Promise<EnergyProjectAnalysisResolutionDto>((resolve) => {
      finishProjectSwitch = resolve;
    });
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot: ngeeSnapshot })
      .mockReturnValueOnce(pendingProjectSwitch);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool], "preschool-demo-org");
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    expect(container.textContent).toContain("Switching to Preschool Demo");
    expect(configApi.getEnergyProjectOverviewMinimum).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Resolving the published analysis");

    await act(async () => {
      finishProjectSwitch({ status: "ready", snapshot: preschoolSnapshot });
      await pendingProjectSwitch;
    });

    expect(container.querySelector("#ngee-ann-recommendations")).toBeNull();
    expect(container.querySelector("#preschool-overall-summary")).not.toBeNull();
    expect(container.textContent).not.toContain("Switching to Preschool Demo");
  });

  it("commits a minimum target Overview before the identity-bound full report is ready", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    const preschool = project("preschool-demo", "Preschool Demo", "preschool-demo-org");
    const ngeeSnapshot = dashboardNgeeAnnSnapshot();
    const preschoolSnapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    const ngeeMinimum = overviewMinimum(ngeeSnapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    const preschoolMinimum = overviewMinimum(preschoolSnapshot, "preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    let finishMinimum!: (minimum: EnergyProjectOverviewMinimumDto) => void;
    let finishFull!: (resolution: EnergyProjectAnalysisResolutionDto) => void;
    const pendingMinimum = new Promise<EnergyProjectOverviewMinimumDto>((resolve) => {
      finishMinimum = resolve;
    });
    const pendingFull = new Promise<EnergyProjectAnalysisResolutionDto>((resolve) => {
      finishFull = resolve;
    });
    vi.spyOn(configApi, "getEnergyProjectOverviewMinimum")
      .mockResolvedValueOnce(ngeeMinimum)
      .mockReturnValueOnce(pendingMinimum);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot: ngeeSnapshot })
      .mockReturnValueOnce(pendingFull);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool], "preschool-demo-org");
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    expect(container.textContent).toContain("Switching to Preschool Demo");

    await act(async () => {
      finishMinimum(preschoolMinimum);
      await pendingMinimum;
      await Promise.resolve();
    });

    expect(container.querySelector("#ngee-ann-recommendations")).toBeNull();
    expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();
    expect(container.textContent).toContain("Preschool Demo");
    expect(container.textContent).toContain("Loading detailed analysis");
    expect(container.textContent).toContain("Energy use");
    expect(container.textContent).not.toContain("Switching to Preschool Demo");
    expect(mockedRouter.replace).not.toHaveBeenCalledWith(
      expect.stringContaining(`currentDataSnapshotId=${encodeURIComponent(preschoolMinimum.binding.currentPin.dataSnapshotId)}`),
      { scroll: false },
    );

    await act(async () => {
      finishFull({ status: "ready", snapshot: preschoolSnapshot });
      await pendingFull;
    });

    expect(container.querySelector("[data-overview-minimum='true']")).toBeNull();
    expect(container.querySelector("#preschool-overall-summary")).not.toBeNull();
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      expect.stringContaining(`currentDataSnapshotId=${encodeURIComponent(preschoolMinimum.binding.currentPin.dataSnapshotId)}`),
      { scroll: false },
    );
    const pinnedHref = mockedRouter.replace.mock.calls
      .map(([href]) => href)
      .find((href) => href.includes(`currentDataSnapshotId=${encodeURIComponent(preschoolMinimum.binding.currentPin.dataSnapshotId)}`));
    expect(pinnedHref).toBeTruthy();
    window.history.replaceState({}, "", pinnedHref!);
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });
    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(configApi.getEnergyProjectOverviewMinimum).toHaveBeenCalledTimes(2);
  });

  it("restores the canonical active Project from the base route through minimum identity before full details", async () => {
    const preschool = project("preschool-demo", "Preschool Demo", "preschool-demo-org");
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    const minimum = overviewMinimum(snapshot, "preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool], "preschool-demo-org");
    window.history.replaceState({}, "", "/energyiq/overview");
    vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockResolvedValue(minimum);
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(configApi.getEnergyProjectOverviewMinimum).toHaveBeenCalledWith("preschool-demo");
    expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();
    expect(container.textContent).toContain("Headline facts are ready. Loading detailed analysis…");
    const explorer = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("View energy consumption"));
    const analyst = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("Ask the advisor"));
    const handoffs = [
      [explorer?.getAttribute("href"), "/energyiq/explorer"],
      [analyst?.getAttribute("href"), "/energyiq/ai"],
    ] as const;
    for (const [href, pathname] of handoffs) {
      expect(href).toBeTruthy();
      const url = new URL(href!, "http://localhost");
      expect(url.pathname).toBe(pathname);
      expect(url.searchParams.get("projectId")).toBe("preschool-demo");
      expect(url.searchParams.get("scopeId")).toBe("project");
      expect(url.searchParams.get("resource")).toBe("electricity");
      expect(url.searchParams.get("period")).toBe("Custom");
      expect(url.searchParams.get("from")).toBe(minimum.binding.currentPin.from);
      expect(url.searchParams.get("to")).toBe(minimum.binding.currentPin.to);
      expect(url.searchParams.get("dataSnapshotId"))
        .toBe(minimum.binding.currentPin.dataSnapshotId);
      expect(url.searchParams.get("projectReleaseId"))
        .toBe(minimum.binding.currentPin.projectReleaseId);
    }
    expect(window.location.pathname).toBe("/energyiq/overview");
    expect(window.location.search).toBe("");
  });

  it("hands Ngee Overview Ask AI the exact August v10 identity instead of a semantic Last 30 days window", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=ngee-ann-polytechnic");
    const snapshot = dashboardNgeeAnnSnapshot();
    snapshot.context.from = "2026-07-31T16:00:00.000Z";
    snapshot.context.to = "2026-08-19T16:00:00.000Z";
    snapshot.context.dataSnapshotId = "44c-current-snapshot-v10";
    snapshot.dataSnapshot.id = "44c-current-snapshot-v10";
    snapshot.projectRelease.id = "ngee-ann-polytechnic-template-v10";
    const minimum = overviewMinimum(snapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockResolvedValue(minimum);
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
      await Promise.resolve();
    });

    const analyst = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .find((anchor) => anchor.textContent?.includes("Ask the advisor"));
    expect(analyst).toBeDefined();
    const url = new URL(analyst!.href);
    expect(url.pathname).toBe("/energyiq/ai");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-08-01",
      to: "2026-08-19",
      dataSnapshotId: "44c-current-snapshot-v10",
      projectReleaseId: "ngee-ann-polytechnic-template-v10",
    });
    expect(url.searchParams.has("analysisWindow")).toBe(false);
  });

  it("rejects a raced full report and rereads it with the minimum Snapshot and Release pin", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const exactSnapshot = dashboardNgeeAnnSnapshot();
    const racedSnapshot = dashboardNgeeAnnSnapshot();
    racedSnapshot.context.dataSnapshotId = "raced-snapshot";
    racedSnapshot.dataSnapshot.id = "raced-snapshot";
    racedSnapshot.projectRelease.id = "raced-release";
    const minimum = overviewMinimum(exactSnapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockResolvedValue(minimum);
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot: racedSnapshot })
      .mockResolvedValueOnce({ status: "ready", snapshot: exactSnapshot });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(2, {
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
      from: minimum.binding.currentPin.from,
      to: minimum.binding.currentPin.to,
      expectedDataSnapshotId: minimum.binding.currentPin.dataSnapshotId,
      expectedProjectReleaseId: minimum.binding.currentPin.projectReleaseId,
    });
    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    expect(container.textContent).not.toContain("raced-snapshot");
  });

  it("rereads a mismatched full report when the minimum arrives after the wait budget", async () => {
    vi.useFakeTimers();
    try {
      const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      mockedAccess.activeProject = ngeeAnn;
      mockedAccess.access = accessContext([ngeeAnn]);
      window.history.replaceState(
        {},
        "",
        "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
      );
      const exactSnapshot = dashboardNgeeAnnSnapshot();
      const racedSnapshot = dashboardNgeeAnnSnapshot();
      racedSnapshot.context.dataSnapshotId = "late-raced-snapshot";
      racedSnapshot.dataSnapshot.id = "late-raced-snapshot";
      racedSnapshot.projectRelease.id = "late-raced-release";
      const minimum = overviewMinimum(exactSnapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      let finishMinimum!: (value: EnergyProjectOverviewMinimumDto) => void;
      let finishFull!: (value: EnergyProjectAnalysisResolutionDto) => void;
      vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockReturnValue(
        new Promise((resolve) => { finishMinimum = resolve; }),
      );
      const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockReturnValueOnce(new Promise((resolve) => { finishFull = resolve; }))
        .mockResolvedValueOnce({ status: "ready", snapshot: exactSnapshot });

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_001);
        finishMinimum(minimum);
        await Promise.resolve();
      });
      expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();

      await act(async () => {
        finishFull({ status: "ready", snapshot: racedSnapshot });
        await Promise.resolve();
      });

      expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
      expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(2, {
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        analysisWindow: "current-project-overview",
        from: minimum.binding.currentPin.from,
        to: minimum.binding.currentPin.to,
        expectedDataSnapshotId: minimum.binding.currentPin.dataSnapshotId,
        expectedProjectReleaseId: minimum.binding.currentPin.projectReleaseId,
      });
      expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes an accepted full report when a late minimum has a foreign Workspace identity", async () => {
    vi.useFakeTimers();
    try {
      const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      mockedAccess.activeProject = ngeeAnn;
      mockedAccess.access = accessContext([ngeeAnn]);
      window.history.replaceState(
        {},
        "",
        "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
      );
      const snapshot = dashboardNgeeAnnSnapshot();
      const foreignMinimum = overviewMinimum(snapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      foreignMinimum.binding.workspaceId = "workspace-foreign";
      let finishMinimum!: (value: EnergyProjectOverviewMinimumDto) => void;
      vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockReturnValue(
        new Promise((resolve) => { finishMinimum = resolve; }),
      );
      vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockResolvedValue({ status: "ready", snapshot });

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_001);
        await Promise.resolve();
      });
      expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

      await act(async () => {
        finishMinimum(foreignMinimum);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector("#ngee-ann-recommendations")).toBeNull();
      expect(container.querySelector("[data-overview-minimum='true']")).toBeNull();
      expect(container.textContent).toContain("Unable to verify the current Overview");
      expect(container.querySelector("a[href*='workspace-foreign']")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks an accepted full report against the minimum Report-time basis", async () => {
    vi.useFakeTimers();
    try {
      const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      mockedAccess.activeProject = ngeeAnn;
      mockedAccess.access = accessContext([ngeeAnn]);
      window.history.replaceState(
        {},
        "",
        "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
      );
      const snapshot = dashboardNgeeAnnSnapshot();
      snapshot.reportTimeContext = reportTimeContextFor(snapshot, "policy-v1");
      const minimum = overviewMinimum(snapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      (minimum.binding as unknown as { reportTimeBasis: ReturnType<typeof reportTimeBasisFromContext> })
        .reportTimeBasis = {
          ...reportTimeBasisFromContext(snapshot.reportTimeContext),
          policyRevision: "policy-v2",
        };
      let finishMinimum!: (value: EnergyProjectOverviewMinimumDto) => void;
      vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockReturnValue(
        new Promise((resolve) => { finishMinimum = resolve; }),
      );
      const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockResolvedValue({ status: "ready", snapshot });

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_001);
        await Promise.resolve();
      });
      expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

      await act(async () => {
        finishMinimum(minimum);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
      expect(container.querySelector("#ngee-ann-recommendations")).toBeNull();
      expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();
      expect(container.textContent).toContain(
        "Detailed analysis is temporarily unavailable. Headline facts remain available.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes an accepted full report when its late Report-time identity is malformed", async () => {
    vi.useFakeTimers();
    try {
      const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      mockedAccess.activeProject = ngeeAnn;
      mockedAccess.access = accessContext([ngeeAnn]);
      window.history.replaceState(
        {},
        "",
        "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
      );
      const snapshot = dashboardNgeeAnnSnapshot();
      snapshot.reportTimeContext = reportTimeContextFor(snapshot, "policy-v1");
      const minimum = overviewMinimum(snapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      snapshot.reportTimeContext.windows[0]!.segments = (
        undefined as unknown as typeof snapshot.reportTimeContext.windows[0]["segments"]
      );
      let finishMinimum!: (value: EnergyProjectOverviewMinimumDto) => void;
      vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockReturnValue(
        new Promise((resolve) => { finishMinimum = resolve; }),
      );
      vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockResolvedValue({ status: "ready", snapshot });

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_001);
        await Promise.resolve();
      });
      expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

      await act(async () => {
        finishMinimum(minimum);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector("#ngee-ann-recommendations")).toBeNull();
      expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();
      expect(container.textContent).toContain(
        "Detailed analysis is temporarily unavailable. Headline facts remain available.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the trusted minimum pin when a late identity correction fails", async () => {
    vi.useFakeTimers();
    try {
      const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      mockedAccess.activeProject = ngeeAnn;
      mockedAccess.access = accessContext([ngeeAnn]);
      window.history.replaceState(
        {},
        "",
        "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
      );
      const exactSnapshot = dashboardNgeeAnnSnapshot();
      const racedSnapshot = dashboardNgeeAnnSnapshot();
      racedSnapshot.context.dataSnapshotId = "late-stale-snapshot";
      racedSnapshot.dataSnapshot.id = "late-stale-snapshot";
      racedSnapshot.projectRelease.id = "late-stale-release";
      const minimum = overviewMinimum(exactSnapshot, "ngee-ann-polytechnic", "Ngee Ann Polytechnic");
      let finishMinimum!: (value: EnergyProjectOverviewMinimumDto) => void;
      vi.mocked(configApi.getEnergyProjectOverviewMinimum).mockReturnValue(
        new Promise((resolve) => { finishMinimum = resolve; }),
      );
      let rejectExact!: (reason?: unknown) => void;
      const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
        .mockResolvedValueOnce({ status: "ready", snapshot: racedSnapshot })
        .mockReturnValueOnce(new Promise((_, reject) => { rejectExact = reject; }));

      await act(async () => {
        root.render(React.createElement(PublishedDecisionDashboard));
        await Promise.resolve();
      });
      expect(resolveProjectAnalysis).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_001);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();

      await act(async () => {
        finishMinimum(minimum);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
      expect(container.querySelector("#ngee-ann-recommendations")).toBeNull();
      expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();
      expect(container.textContent).toContain("Headline facts are ready. Loading detailed analysis…");
      const pendingHref = mockedRouter.replace.mock.calls.at(-1)?.[0];
      expect(pendingHref).toContain(
        `currentDataSnapshotId=${encodeURIComponent(minimum.binding.currentPin.dataSnapshotId)}`,
      );
      expect(pendingHref).not.toContain("late-stale-snapshot");

      await act(async () => {
        rejectExact(new ConfigApiError("INTERNAL_ERROR", "EXACT_TIMEOUT", 500));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.textContent).toContain(
        "Detailed analysis is temporarily unavailable. Headline facts remain available.",
      );
      expect(container.textContent).not.toContain("EXACT_TIMEOUT");
      const finalHref = mockedRouter.replace.mock.calls.at(-1)?.[0];
      expect(finalHref).toContain(
        `currentDataSnapshotId=${encodeURIComponent(minimum.binding.currentPin.dataSnapshotId)}`,
      );
      expect(finalHref).toContain(
        `currentProjectReleaseId=${encodeURIComponent(minimum.binding.currentPin.projectReleaseId)}`,
      );
      expect(finalHref).not.toContain("late-stale-snapshot");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps minimum headline facts usable when detailed analysis fails", async () => {
    const preschool = project("preschool-demo", "Preschool Demo", "preschool-demo-org");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool], "preschool-demo-org");
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const snapshot = dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot());
    vi.mocked(configApi.getEnergyProjectOverviewMinimum)
      .mockResolvedValue(overviewMinimum(snapshot, "preschool-demo", "Preschool Demo"));
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new ConfigApiError("INTERNAL_ERROR", "DETAIL_TIMEOUT", 500));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-overview-minimum='true']")).not.toBeNull();
    expect(container.textContent).toContain("Energy use");
    expect(container.textContent).toContain(
      "Detailed analysis is temporarily unavailable. Headline facts remain available.",
    );
    expect(container.textContent).not.toContain("DETAIL_TIMEOUT");
    expect(Array.from(container.querySelectorAll("button"), (button) => button.textContent))
      .toContain("Retry details");
    expect(container.textContent).not.toContain("Published analysis is unavailable");
  });

  it("does not expose internal resolver details when minimum and detailed analysis both fail", async () => {
    const preschool = project("preschool-demo", "Preschool Demo", "preschool-demo-org");
    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool], "preschool-demo-org");
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    vi.mocked(configApi.getEnergyProjectOverviewMinimum)
      .mockRejectedValue(new ConfigApiError("INTERNAL_ERROR", "MINIMUM_QUERY_TIMEOUT", 500));
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockRejectedValue(new ConfigApiError("INTERNAL_ERROR", "DETAIL_TIMEOUT", 500));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Published analysis is unavailable");
    expect(container.textContent).toContain("Current overview is temporarily unavailable.");
    expect(container.textContent).toContain(
      "Retry the same Project and period without changing the published template.",
    );
    expect(container.textContent).not.toContain("DETAIL_TIMEOUT");
    expect(container.textContent).not.toContain("MINIMUM_QUERY_TIMEOUT");
  });

  it("keeps the previous Project Overview when the workspace target fails", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    const preschool = project("preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot: dashboardNgeeAnnSnapshot() })
      .mockRejectedValueOnce(new ConfigApiError("INTERNAL_ERROR", "TARGET_TIMEOUT", 500));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(container.querySelector("#ngee-ann-recommendations")).not.toBeNull();
    expect(container.textContent).toContain("Could not switch to Preschool Demo");
    expect(container.textContent).toContain("The previous report remains available");
    expect(container.textContent).not.toContain("Published analysis is unavailable");
  });

  it("ignores a late workspace response after the user selects a newer target", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    const preschool = project("preschool-demo", "Preschool Demo");
    const tuya = project("tuya-office", "Tuya Office");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    let finishPreschool!: (resolution: EnergyProjectAnalysisResolutionDto) => void;
    let finishTuya!: (resolution: EnergyProjectAnalysisResolutionDto) => void;
    const pendingPreschool = new Promise<EnergyProjectAnalysisResolutionDto>((resolve) => {
      finishPreschool = resolve;
    });
    const pendingTuya = new Promise<EnergyProjectAnalysisResolutionDto>((resolve) => {
      finishTuya = resolve;
    });
    const initialSnapshot = dashboardNgeeAnnSnapshot();
    const tuyaSnapshot = dashboardNgeeAnnSnapshot();
    tuyaSnapshot.context.projectId = "tuya-office";
    tuyaSnapshot.context.projectName = "Tuya Office";
    tuyaSnapshot.context.dataSnapshotId = "tuya-snapshot-current";
    tuyaSnapshot.dataSnapshot.id = "tuya-snapshot-current";
    tuyaSnapshot.projectRelease.id = "tuya-office-template-current";
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot: initialSnapshot })
      .mockReturnValueOnce(pendingPreschool)
      .mockReturnValueOnce(pendingTuya);

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    mockedAccess.activeProject = tuya;
    mockedAccess.access = accessContext([tuya]);
    window.history.replaceState({}, "", "/energyiq/overview?projectId=tuya-office&scopeId=project&resource=electricity");
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    await act(async () => {
      finishPreschool({ status: "ready", snapshot: dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot()) });
      await pendingPreschool;
    });

    expect(container.textContent).toContain("Switching to Tuya Office");
    expect(container.textContent).toContain("Ngee Ann Polytechnic");
    expect(mockedRouter.replace).not.toHaveBeenCalledWith(
      expect.stringContaining("projectId=preschool-demo"),
      expect.anything(),
    );

    await act(async () => {
      finishTuya({ status: "ready", snapshot: tuyaSnapshot });
      await pendingTuya;
    });

    expect(container.textContent).not.toContain("Switching to Tuya Office");
    expect(container.textContent).toContain("Tuya Office");
    expect(mockedRouter.replace).toHaveBeenCalledWith(
      expect.stringContaining("projectId=tuya-office"),
      { scroll: false },
    );
  });

  it("does not carry a user Refresh cache bypass into the next workspace", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    const preschool = project("preschool-demo", "Preschool Demo");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    const resolveProjectAnalysis = vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockResolvedValueOnce({ status: "ready", snapshot: dashboardNgeeAnnSnapshot() })
      .mockResolvedValueOnce({ status: "ready", snapshot: dashboardNgeeAnnSnapshot() })
      .mockResolvedValueOnce({
        status: "ready",
        snapshot: dashboardNgeeAnnSnapshot(preschoolGoldenSnapshot()),
      });

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });
    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh current overview");
    await act(async () => refresh?.click());

    mockedAccess.activeProject = preschool;
    mockedAccess.access = accessContext([preschool]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&comparison=overlay&category=all",
    );
    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
      await Promise.resolve();
    });

    expect(resolveProjectAnalysis).toHaveBeenCalledTimes(3);
    expect(resolveProjectAnalysis).toHaveBeenNthCalledWith(3, {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
  });

  it("keeps the current cutoff pin while forcing a legacy Ngee Ann Scope to Project", async () => {
    const ngeeAnn = project("ngee-ann-polytechnic", "Ngee Ann Polytechnic");
    mockedAccess.activeProject = ngeeAnn;
    mockedAccess.access = accessContext([ngeeAnn]);
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&scopeId=level-7&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1",
    );
    vi.spyOn(configApi, "resolveProjectAnalysis")
      .mockReturnValue(new Promise<never>(() => undefined));

    await act(async () => {
      root.render(React.createElement(PublishedDecisionDashboard));
    });

    expect(container.querySelector("[role='combobox'][aria-label='Analysis Scope']")).toBeNull();
    expect(configApi.resolveProjectAnalysis).toHaveBeenCalledWith({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-v1",
      expectedProjectReleaseId: "release-v1",
    });
  });

});

describe("published Overview date inputs", () => {
  it("formats trusted UTC boundaries in the Project timezone", () => {
    expect(toDateInput("2026-07-26T16:00:00.000Z", "Asia/Singapore")).toBe("2026-07-27");
    expect(toDateInput("2026-08-02T15:59:59.999Z", "Asia/Singapore")).toBe("2026-08-02");
  });

  it("asks the server to resolve the Project root instead of hard-coding a customer Scope", () => {
    expect(overviewAnalysisRequest(
      "generic-demo",
      "Last 7 days",
      { from: "", to: "" },
    )).toEqual({
      projectId: "generic-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Last 7 days",
    });
  });

  it("asks the server for the Project Overview window without branching on Project identity", () => {
    expect(currentOverviewAnalysisRequest("ngee-ann-polytechnic", {
      scopeId: "level-7",
      resource: "electricity",
    })).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-7",
      resource: "electricity",
      analysisWindow: "current-project-overview",
    });
    expect(currentOverviewAnalysisRequest("preschool-demo")).toMatchObject({
      projectId: "preschool-demo",
      analysisWindow: "current-project-overview",
    });
  });

  it("round-trips the server-validated current window pin and restores it on reload", () => {
    const view = overviewViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=level-7&resource=electricity&currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1",
    ));

    expect(view.currentOverviewPin).toEqual({
      from: "2026-05-20",
      to: "2026-06-16",
      dataSnapshotId: "snapshot-v1",
      projectReleaseId: "release-v1",
    });
    expect(currentOverviewAnalysisRequest("ngee-ann-polytechnic", {
      scopeId: view.scopeId,
      resource: view.resource,
      currentOverviewPin: view.currentOverviewPin,
    })).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-7",
      resource: "electricity",
      analysisWindow: "current-project-overview",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-v1",
      expectedProjectReleaseId: "release-v1",
    });
    expect(currentOverviewUrlWithView(view)).toContain(
      "currentFrom=2026-05-20&currentTo=2026-06-16&currentDataSnapshotId=snapshot-v1&currentProjectReleaseId=release-v1",
    );
  });

  it("shows partial charts and advisory while suppressing action modules and Save below 95% coverage", () => {
    const policy = applyProjectAnalysisQualityPolicy({
      dataQuality: dataQuality(3.2258),
      plan: overviewPlan(),
    });

    expect(policy).toMatchObject({
      advisories: [{ title: "Partial data" }],
      saveAllowed: false,
    });
    expect(policy.plan.module_count).toBe(2);
    expect(policy.plan.sections.flatMap((section) => section.modules.map((module) => module.component.view_key)))
      .toEqual(["data_quality_summary_v1", "consumption_overview_v1"]);
  });

  it("keeps the published Overview and Save available at the 95% accepted gate", () => {
    const policy = applyProjectAnalysisQualityPolicy({
      dataQuality: dataQuality(95),
      plan: overviewPlan(),
    });

    expect(policy).toMatchObject({
      advisories: [],
      saveAllowed: true,
    });
    expect(policy.plan.module_count).toBe(5);
  });
});

function overviewPlan() {
  const catalog: EnergyComponentRevisionDto[] = [
    component("quality.data_coverage@1", "quality", "data_quality_summary_v1"),
    component("overview.consumption@1", "overview", "consumption_overview_v1"),
    component("decision.executive_actions@1", "decision", "executive_action_summary_v1"),
    component("decision.recommended_actions@1", "decision", "recommended_actions_v1"),
    component("evidence.exceptions@1", "evidence", "exceptions_evidence_v1"),
  ];
  const template: EnergyTemplateDefinitionDto = {
    template_id: "project",
    target_kind: "project",
    components: catalog.map((item) => ({
      component_revision_id: item.revision_id,
      enabled: true,
    })),
  };
  return buildEnergyTemplateRenderPlan({ template, catalog });
}

function dataQuality(coveragePct: number) {
  return {
    status: coveragePct >= 95 ? "complete" as const : "partial" as const,
    coveragePct,
    expectedMeterIntervalCount: 100,
    validIntervalCount: Math.floor(coveragePct),
    qualityEventCount: 0,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    importBatchIds: ["batch-1"],
  };
}

function component(
  revisionId: string,
  family: EnergyComponentRevisionDto["family"],
  viewKey: string,
): EnergyComponentRevisionDto {
  return {
    revision_id: revisionId,
    component_id: revisionId.replace("@1", ""),
    version: 1,
    display_name: revisionId,
    description: revisionId,
    family,
    view_key: viewKey,
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "always",
    created_at: "2026-08-04T00:00:00.000Z",
  };
}

function project(id: string, name: string, workspaceId = "workspace-1"): EnergyProjectDto {
  return { id, name, workspaceId, status: "published", timezone: "Asia/Singapore" };
}

function overviewMinimum(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  projectId: string,
  projectName: string,
): EnergyProjectOverviewMinimumDto {
  const readySnapshot = snapshot;
  return {
    status: "ready",
    contract: "energyiq-current-overview-minimum@2",
    binding: {
      workspaceId: readySnapshot.context.workspaceId,
      projectId,
      scopeId: readySnapshot.context.scopeId,
      resource: "electricity",
      currentPin: {
        from: toDateInput(readySnapshot.context.from, readySnapshot.context.timezone),
        to: toDateInput(
          new Date(Date.parse(readySnapshot.context.to) - 1).toISOString(),
          readySnapshot.context.timezone,
        ),
        dataSnapshotId: readySnapshot.context.dataSnapshotId,
        projectReleaseId: readySnapshot.projectRelease.id,
      },
      primaryReportWindowId: readySnapshot.reportTimeContext
        ? readySnapshot.renderer.key === "ngee-ann-overview"
          ? "current-month-progress"
          : "current-overview"
        : null,
      reportTimeBasis: readySnapshot.reportTimeContext
        ? reportTimeBasisFromContext(readySnapshot.reportTimeContext)
        : null,
    },
    presentation: {
      projectName,
      title: readySnapshot.renderer.key === "ngee-ann-overview"
        ? "Energy decision overview"
        : "Energy overview",
      renderer: {
        key: readySnapshot.renderer.key,
        version: "1",
        contractVersion: "project-analysis-snapshot@1",
      },
      reportWindow: {
        label: "Calendar month to date",
        start: readySnapshot.context.from,
        endExclusive: readySnapshot.context.to,
        timezone: readySnapshot.context.timezone,
      },
      navigation: [{ id: `${projectId}-overview`, label: "Overview", number: "1", depth: 0 }],
    },
    headline: {
      dataQuality: {
        status: "usable",
        coveragePct: 100,
        expectedMeterIntervalCount: 96,
        validIntervalCount: 96,
        qualityEventCount: 0,
      },
      metrics: [{
        id: "energy",
        label: "Energy use",
        value: 1531.17,
        unit: "kWh",
        available: true,
      }],
    },
  };
}

function reportTimeContextFor(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  policyRevision: string,
): NonNullable<EnergyProjectAnalysisSnapshotDto["reportTimeContext"]> {
  return {
    contractRevision: "energyiq-report-time-context@1",
    binding: {
      workspaceId: snapshot.context.workspaceId,
      projectId: snapshot.context.projectId,
      scopeId: snapshot.context.scopeId,
      resource: snapshot.context.resource,
      dataSnapshotId: snapshot.context.dataSnapshotId,
      projectReleaseId: snapshot.projectRelease.id,
    },
    timezone: snapshot.context.timezone,
    asOf: snapshot.context.resolvedAt,
    acceptedDataEndExclusive: snapshot.context.to,
    dataThroughLocalDate: toDateInput(
      new Date(Date.parse(snapshot.context.to) - 1).toISOString(),
      snapshot.context.timezone,
    ),
    lastRefreshedAt: snapshot.context.resolvedAt,
    policyId: "ngee-ann-report-time",
    policyRevision,
    windows: [{
      windowId: snapshot.renderer.key === "ngee-ann-overview"
        ? "current-month-progress"
        : "current-overview",
      role: snapshot.renderer.key === "ngee-ann-overview" ? "current_progress" : "primary",
      label: "Calendar month to date",
      strategy: { kind: "calendar_month_to_date" },
      phase: "partial",
      from: snapshot.context.from,
      toExclusive: snapshot.context.to,
      completeDayCount: 16,
      segments: [{ from: snapshot.context.from, toExclusive: snapshot.context.to }],
      comparisonCompatibilityKey: "calendar-month-progress",
    }],
  };
}

function accessContext(projects: EnergyProjectDto[], activeWorkspaceId = "workspace-1"): EnergyAccessContextDto {
  return {
    role: "user",
    user: { id: "user-1" },
    activeWorkspaceId,
    workspaces: [],
    projects,
  };
}

function projectHierarchy(): EnergyProjectHierarchyDto {
  return {
    project: {
      id: "ngee-ann-polytechnic",
      name: "Ngee Ann Polytechnic",
      hierarchy_revision_id: "hierarchy-v6",
    },
    tiers: [
      { id: "tier-level", ordinal: 2, alias: "Level" },
      { id: "tier-circuit", ordinal: 1, alias: "Circuit" },
    ],
    nodes: [
      {
        id: "ngee-ann-polytechnic",
        project_id: "ngee-ann-polytechnic",
        name: "Ngee Ann Polytechnic",
        node_type: "project",
        sort_order: 0,
        metadata_status: "confirmed",
      },
      {
        id: "level-6",
        project_id: "ngee-ann-polytechnic",
        name: "Level 6",
        node_type: "level",
        tier_definition_id: "tier-level",
        sort_order: 1,
        metadata_status: "confirmed",
      },
      {
        id: "l6-light-left",
        project_id: "ngee-ann-polytechnic",
        parent_id: "level-6",
        name: "L6 Light Left",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 1,
        metadata_status: "confirmed",
      },
      {
        id: "l6-total-light",
        project_id: "ngee-ann-polytechnic",
        parent_id: "level-6",
        name: "Total Office Load",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 2,
        metadata_status: "confirmed",
      },
      {
        id: "level-7",
        project_id: "ngee-ann-polytechnic",
        name: "Level 7",
        node_type: "level",
        tier_definition_id: "tier-level",
        sort_order: 2,
        metadata_status: "confirmed",
      },
      {
        id: "l7-total-office",
        project_id: "ngee-ann-polytechnic",
        parent_id: "level-7",
        name: "Total Office Load",
        node_type: "circuit",
        tier_definition_id: "tier-circuit",
        sort_order: 1,
        metadata_status: "confirmed",
      },
    ],
  };
}

function readyRangeResolution(): EnergyProjectAnalysisResolutionDto {
  return {
    status: "ready",
    snapshot: {
      context: {
        from: "2026-06-09T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      projectRelease: {
        id: "release-1",
        templateRevisionId: null,
        document: { templates: [] },
        catalog: [],
      },
      renderer: { key: "ngee-ann-overview" },
      dataSnapshot: { id: "snapshot-1" },
    },
  } as EnergyProjectAnalysisResolutionDto;
}

function dashboardNgeeAnnSnapshot(snapshot = ngeeAnnGoldenSnapshot()) {
  if (snapshot.projectRelease.renderer.key === "preschool-overview") {
    snapshot.projectRelease.renderer.aiPresentationMode = "html";
  }
  const qualityComponent = component("quality.data_coverage@1", "quality", "data_quality_summary_v1");
  snapshot.projectRelease.catalog = [qualityComponent];
  snapshot.projectRelease.document = {
    schema_version: 2,
    templates: [{
      template_id: "project",
      target_kind: "project",
      components: [{ component_revision_id: qualityComponent.revision_id, enabled: true }],
    }],
  };
  return snapshot;
}

function readyZeroCoverageResolution(
  period: "Last 7 days" | "Previous week" | "Previous month",
): EnergyProjectAnalysisResolutionDto {
  const qualityComponent = component("quality.data_coverage@1", "quality", "data_quality_summary_v1");
  const quality = dataQuality(0);
  const from = period === "Previous week"
    ? "2026-07-26T16:00:00.000Z"
    : period === "Previous month"
      ? "2026-06-30T16:00:00.000Z"
      : "2026-07-27T16:00:00.000Z";
  const to = period === "Previous week"
    ? "2026-08-02T16:00:00.000Z"
    : period === "Previous month"
      ? "2026-07-31T16:00:00.000Z"
      : "2026-08-03T16:00:00.000Z";
  const context: EnergyQueryContextDto = {
    userId: "user-1",
    workspaceId: "workspace-1",
      projectId: "generic-demo",
    projectName: "Ngee Ann Polytechnic",
    scopeId: "project",
    scopeName: "Ngee Ann Polytechnic",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from,
    to,
    endExclusive: true,
    period,
    hierarchyRevisionId: "hierarchy-v6",
    meterMappingRevisionId: "mapping-v1",
    meterFormulaRevisionId: "formula-v1",
    dataSnapshotId: "snapshot-zero-coverage",
    metricVersion: "metric-v1",
    businessCalendarVersion: "calendar-v1",
    tariffScheduleVersion: "tariff-v1",
    resolvedAt: "2026-08-03T16:30:00.000Z",
  };
  const metadata: EnergyProjectAnalysisMetadataDto = {
    status: "missing",
    hierarchyRevisionId: context.hierarchyRevisionId,
    timezone: context.timezone,
    period: { start: from, endExclusive: to },
    selectedScope: {
      scopeId: context.scopeId,
      scopeName: context.scopeName,
      usageKwh: 0,
      status: "missing",
      area: {
        status: "missing",
        value: null,
        unit: "m2",
        reason: "not-configured",
        guidance: "Configure area metadata.",
        metadataRevisionIds: [],
        hierarchyRevisionIds: [context.hierarchyRevisionId],
        evidence: [],
      },
      headcount: {
        status: "missing",
        value: null,
        unit: "people",
        reason: "not-configured",
        guidance: "Configure headcount metadata.",
        metadataRevisionIds: [],
        hierarchyRevisionIds: [context.hierarchyRevisionId],
        evidence: [],
      },
      normalisations: {
        eui: {
          status: "missing",
          metricId: "energy.usage_per_sqm",
          value: null,
          unit: "kWh/m2",
          reason: "not-configured",
          guidance: "Configure area metadata.",
          metadataRevisionIds: [],
          hierarchyRevisionIds: [context.hierarchyRevisionId],
          evidence: [],
        },
        perPax: {
          status: "missing",
          metricId: "energy.usage_per_person",
          value: null,
          unit: "kWh/person",
          reason: "not-configured",
          guidance: "Configure headcount metadata.",
          metadataRevisionIds: [],
          hierarchyRevisionIds: [context.hierarchyRevisionId],
          evidence: [],
        },
      },
      evidence: [],
    },
    comparisonScopes: [],
    evidence: [],
  };
  const analysis: EnergyProjectAnalysisPayloadDto = {
    context,
    latestAcceptedReading: {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "LEAF_METER_REQUIRED",
        message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
      },
    },
    summary: {
      usageKwh: 0,
      averageDailyUsageKwh: 0,
      peakKw: 0,
      validIntervalCount: 0,
      qualityEventCount: 0,
    },
    hourlyProfile: [],
    comparison: { from, to, usageKwh: 0, changeKwh: 0, changePct: null },
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    offHours: {
      status: "unavailable",
      reason: { code: "OPERATING_FACTS_UNAVAILABLE", message: "No accepted intervals." },
      businessCalendarVersion: context.businessCalendarVersion,
    },
    cost: {
      status: "unavailable",
      reason: { code: "COST_FACTS_UNAVAILABLE", message: "No accepted intervals." },
      tariffScheduleVersion: context.tariffScheduleVersion,
    },
    dataHealth: quality,
    units: { usage: "kWh", demand: "kW", intervalMinutes: 15, timezone: context.timezone },
    attention: [],
    provenance: {
      dataSnapshotId: context.dataSnapshotId,
      hierarchyRevisionId: context.hierarchyRevisionId,
      meterMappingRevisionId: context.meterMappingRevisionId,
      meterFormulaRevisionId: context.meterFormulaRevisionId,
      metricVersion: context.metricVersion,
      ruleRevisionIds: [],
      aggregationRule: "designated_total",
      sourceView: "energy_scope_intervals",
      queryIds: [
        "scope_summary_v1",
        "hourly_profile_v1",
        "meter_breakdown_v1",
        "operational_policy_scope_intervals_v1",
        "operational_policy_meter_intervals_v1",
      ],
    },
    metadata,
  };
  const projectRelease: EnergyPublishedProjectReleaseDto = {
    id: "release-zero-coverage",
    source: "template-revision",
    projectId: context.projectId,
    templateRevisionId: "template-zero-coverage",
    templateRevisionSequence: 1,
    recipe: { id: "energy-scope-analysis", version: "1" },
    renderer: {
      key: "ngee-ann-overview",
      version: "1",
      contractVersion: "project-analysis-snapshot@1",
    },
    hierarchyRevisionId: context.hierarchyRevisionId,
    meterMappingRevisionId: context.meterMappingRevisionId,
    meterFormulaRevisionId: context.meterFormulaRevisionId,
    metricRevisionIds: [],
    ruleRevisionIds: [],
    businessCalendarVersion: context.businessCalendarVersion,
    tariffScheduleVersion: context.tariffScheduleVersion,
    publishedAt: "2026-08-03T00:00:00.000Z",
    document: {
      schema_version: 2,
      templates: [{
        template_id: "project",
        target_kind: "project",
        components: [{
          component_revision_id: qualityComponent.revision_id,
          enabled: true,
        }],
      }],
    },
    catalog: [qualityComponent],
  };
  const resolution: EnergyProjectAnalysisResolutionDto = {
    status: "ready",
    snapshot: {
      context: {
        ...context,
        primaryPeriod: { start: from, endExclusive: to },
        projectReleaseId: projectRelease.id,
      },
      projectRelease,
      recipe: projectRelease.recipe,
      renderer: projectRelease.renderer,
      dataSnapshot: { id: context.dataSnapshotId, importBatchIds: [], lastSeenAt: null },
      dataQuality: quality,
      evidence: [],
      findings: [],
      metadata,
      analysis,
    },
  };
  if (resolution.status === "ready") {
    Object.assign(resolution.snapshot, {
      latestAvailablePeriod: { period: "Custom", from: "2026-06-10", to: "2026-06-16" },
    });
  }
  return resolution;
}
