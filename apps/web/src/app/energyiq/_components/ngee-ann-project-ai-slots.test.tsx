/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectOverviewAiReadModelDto } from "../../../lib/config-api";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { NgeeAnnProjectAiSlots } from "./ngee-ann-project-ai-slots";

describe("NgeeAnnProjectAiSlots", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("restores exact stored Key Findings and four Section states through one read-only GET", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const restore = vi.fn().mockResolvedValue(readModel(snapshot));

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots snapshot={snapshot} restore={restore} />);
    });

    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(snapshot.context.projectId, snapshot.context.scopeId, {
      from: "2026-06-10",
      to: "2026-06-16",
      dataSnapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
    });
    expect(container.textContent).toContain("4 of 4 Sections ready");
    expect(container.textContent).toContain("Peak demand and time behaviour should be read together");
    expect(container.textContent).toContain("Trend and demand");
    expect(container.textContent).toContain("Time behaviour");
    expect(container.textContent).toContain("Circuit concentration");
    expect(container.textContent).toContain("Decision priorities");
    expect(container.textContent).toContain("Possible");
    expect(container.textContent).toContain("Not generated for this Snapshot yet");
  });

  it("never displays a read model from another Snapshot", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const wrong = readModel(snapshot);
    wrong.binding.dataSnapshotId = "snapshot-stale";

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots snapshot={snapshot} restore={vi.fn().mockResolvedValue(wrong)} />);
    });

    expect(container.textContent).toContain("does not match this Snapshot");
    expect(container.textContent).not.toContain("Peak demand and time behaviour should be read together");
  });

  it("renders accepted Additional Insights as distinct exploratory cards", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const model = readModel(snapshot);
    model.additionalInsights = {
      status: "available",
      artifactId: "artifact:additional",
      result: {
        status: "available",
        findings: [{
          id: "additional:off-hours-load",
          title: "Off-hours use may be driven by equipment load",
          text: "**Evidence signal:** Off-hours use is 37.9%.\n\n**AI angle:** Test whether plug and equipment loads dominate it.",
          epistemicStatus: "inferred",
          evidenceRefs: ["evidence:off-hours", "evidence:load-share"],
          deepDiveQuestion: "How much off-hours use belongs to load rather than lighting?",
        }],
      },
    };

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots snapshot={snapshot} restore={vi.fn().mockResolvedValue(model)} />);
    });

    expect(container.textContent).toContain("Additional AI Insights");
    expect(container.textContent).toContain("Off-hours use may be driven by equipment load");
    expect(container.textContent).toContain("Evidence signal:");
    expect(container.textContent).toContain("AI angle:");
    expect(container.textContent).toContain("Inferred");
    expect(container.textContent).toContain("Explore further");
    expect(container.textContent).toContain("How much off-hours use belongs to load rather than lighting?");
    expect(container.textContent).toContain("Evidence · 2");
    expect(container.textContent).not.toContain("Additional AI InsightsAvailable.");
  });

  it("renders an exact frozen Saved read model without issuing a live restore request", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const restore = vi.fn();

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots
        snapshot={snapshot}
        savedModel={readModel(snapshot)}
        restore={restore}
      />);
    });

    expect(restore).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Peak demand and time behaviour should be read together");
    expect(container.textContent).toContain("4 of 4 Sections ready");
  });

  it("renders the exact fifth Holiday artifact only for the five-Section Release", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.sectionManifest = {
      contract: "energyiq-ngee-ann-section-manifest@1",
      projectReleaseId: snapshot.projectRelease.id,
      enabledSectionIds: [
        "trend-and-demand", "time-behaviour", "circuit-concentration", "decision-priorities",
        "school-holiday-comparison",
      ],
      disabledCapabilities: [],
    };
    const model = readModel(snapshot);
    model.sections["school-holiday-comparison"] = {
      status: "available",
      artifactId: "artifact:school-holiday-comparison",
      result: {
        status: "available",
        summary: {
          text: "Holiday weekday use is lower, while the exact hourly gaps remain worth checking.",
          evidenceRefs: ["evidence:holiday"],
        },
        insights: [],
      },
    };

    await act(async () => {
      root.render(<NgeeAnnProjectAiSlots snapshot={snapshot} savedModel={model} />);
    });

    expect(container.textContent).toContain("5 of 5 Sections ready");
    expect(container.textContent).toContain("School Holiday Comparison");
    expect(container.textContent).not.toContain("学校假期对比");
    expect(container.textContent).toContain("Holiday weekday use is lower");
  });
});

const readModel = (snapshot: ReturnType<typeof ngeeAnnGoldenSnapshot>): EnergyProjectOverviewAiReadModelDto => ({
  contract: "energyiq-project-overview-ai-read-model@1",
  rendererKey: "ngee-ann-overview",
  binding: {
    workspaceId: snapshot.context.workspaceId,
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: { from: snapshot.context.primaryPeriod.start, to: snapshot.context.primaryPeriod.endExclusive },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 8,
    generation: {},
  },
  keyFindings: {
    status: "available",
    artifactId: "artifact:executive",
    result: {
      status: "available",
      summary: { text: "Peak demand and time behaviour should be read together.", evidenceRefs: ["evidence:trend"] },
      findings: [{
        id: "finding:1", title: "A shared operational boundary is possible", text: "The timing pattern may help explain when the peak forms.",
        epistemicStatus: "speculative", evidenceRefs: ["evidence:trend", "evidence:time"],
      }],
    },
  },
  sections: Object.fromEntries(["trend-and-demand", "time-behaviour", "circuit-concentration", "decision-priorities"].map((sectionId) => [sectionId, {
    status: "available",
    artifactId: `artifact:${sectionId}`,
    result: {
      status: "available",
      summary: { text: `Current ${sectionId} conclusion.`, evidenceRefs: [`evidence:${sectionId}`] },
      insights: [],
    },
  }])),
  additionalInsights: { status: "missing" },
});
