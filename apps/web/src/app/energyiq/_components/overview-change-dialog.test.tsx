/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergySavedAnalysisDetailDto,
  EnergySavedAnalysisSummaryDto,
} from "../../../lib/config-api";
import { OverviewChangeDialog } from "./overview-change-dialog";

describe("OverviewChangeDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("loads the latest compatible frozen Overview and shows an honest deterministic comparison", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const previousSummary = summary("saved-a", "snapshot-a", 4);
    const previous = detail(previousSummary, snapshot("snapshot-a", "release-a", 1_000));
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({
        items: [summary("same-snapshot", "snapshot-b", 5), previousSummary],
      }),
      getEnergySavedAnalysis: vi.fn().mockResolvedValue(previous),
    };
    const onOpenPrevious = vi.fn();

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={onOpenPrevious}
        />,
      );
    });

    expect(container.textContent).toContain("What changed?");
    expect(container.textContent).toContain("No model run is started by this comparison");
    expect(container.textContent).toContain("Snapshot A");
    expect(container.textContent).toContain("snapshot-a");
    expect(container.textContent).toContain("Snapshot B");
    expect(container.textContent).toContain("snapshot-b");
    expect(container.textContent).toContain("+100 kWh");
    expect(container.textContent).toContain("Current AI Artifact is not available in this comparison yet");
    expect(client.getEnergySavedAnalysis).toHaveBeenCalledWith("preschool-demo", "saved-a");

    const openPrevious = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Open previous Overview"));
    await act(async () => openPrevious?.click());
    expect(onOpenPrevious).toHaveBeenCalledWith("saved-a");
  });

  it("uses the lightweight comparison projection without downloading full Saved Overview details", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const previousSummary = summary("saved-a", "snapshot-a", 4);
    const previous = detail(previousSummary, snapshot("snapshot-a", "release-a", 1_000));
    const client = {
      listEnergySavedOverviewComparisonCandidates: vi.fn().mockResolvedValue({ items: [previous] }),
      listEnergySavedAnalyses: vi.fn().mockRejectedValue(new Error("full Saved list should not be read")),
      getEnergySavedAnalysis: vi.fn().mockRejectedValue(new Error("full Saved detail should not be read")),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Snapshot A");
    expect(container.textContent).toContain("snapshot-a");
    expect(client.listEnergySavedOverviewComparisonCandidates).toHaveBeenCalledWith("preschool-demo");
    expect(client.listEnergySavedAnalyses).not.toHaveBeenCalled();
    expect(client.getEnergySavedAnalysis).not.toHaveBeenCalled();
  });

  it("shows which Key Findings were retained, updated, added, or removed", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const previousSummary = summary("saved-a", "snapshot-a", 1);
    const previous = detail(previousSummary, snapshot("snapshot-a", "release-a", 1_000));
    previous.aiArtifact = aiArtifact("snapshot-a", "release-a", [
      ["Lighting remains the first priority", "Lighting is the largest closed-hours signal."],
      ["Centre H has the highest per-person intensity", "Centre H ranks first per person."],
      ["Old planning assumption", "The plan used May only."],
    ]);
    const currentAi = aiArtifact("snapshot-b", "release-b", [
      ["Lighting remains the first priority", "Lighting is the largest closed-hours signal."],
      ["Centre H has the highest per-person intensity", "Centre H still ranks first, with provisional headcount."],
      ["Load mix is missing from priority flags", "Load dominates energy but is not part of the normalised flag."],
    ]);
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({ items: [previousSummary] }),
      getEnergySavedAnalysis: vi.fn().mockResolvedValue(previous),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={currentAi}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Retained");
    expect(container.textContent).toContain("Updated");
    expect(container.textContent).toContain("New");
    expect(container.textContent).toContain("Removed");
    expect(container.textContent).toContain("Load mix is missing from priority flags");
    expect(container.textContent).toContain("Old planning assumption");
  });

  it("explains when no compatible previous saved Overview exists", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({ items: [summary("same", "snapshot-b", 1)] }),
      getEnergySavedAnalysis: vi.fn(),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("No compatible previous Overview is saved yet");
    expect(client.getEnergySavedAnalysis).not.toHaveBeenCalled();
  });

  it("searches beyond ten candidates and skips incompatible or failed detail reads", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const candidateItems = Array.from({ length: 12 }, (_, index) => ({
      ...summary(`candidate-${index + 1}`, `snapshot-${index + 1}`, 12 - index),
      createdAt: new Date(Date.UTC(2026, 7, 15, 0, 0, 12 - index)).toISOString(),
    }));
    const valid = detail(candidateItems[11]!, snapshot("snapshot-a", "release-a", 1_000));
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({ items: candidateItems }),
      getEnergySavedAnalysis: vi.fn(async (_projectId: string, analysisId: string) => {
        if (analysisId === "candidate-12") return valid;
        return detail(
          candidateItems.find(({ id }) => id === analysisId)!,
          snapshot(`frozen-${analysisId}`, "release-old", 900, "ngee-ann-overview"),
        );
      }),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("snapshot-a");
    expect(client.getEnergySavedAnalysis).toHaveBeenCalledTimes(12);
  });

  it("does not silently fall back to an older A when a newer Saved detail cannot be verified", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({
        items: [
          { ...summary("newer", "snapshot-newer", 2), createdAt: "2026-08-15T02:00:00.000Z" },
          { ...summary("older", "snapshot-older", 1), createdAt: "2026-08-15T01:00:00.000Z" },
        ],
      }),
      getEnergySavedAnalysis: vi.fn(async (_projectId: string, analysisId: string) => {
        if (analysisId === "newer") throw new Error("newer Saved Overview could not be verified");
        return detail(summary("older", "snapshot-older", 1), snapshot("snapshot-a", "release-a", 1_000));
      }),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("newer Saved Overview could not be verified");
    expect(container.textContent).not.toContain("Snapshot A:");
  });

  it("skips a legacy Saved entry with an invalid AI payload and compares the next verified Overview", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({
        items: [
          { ...summary("legacy-invalid-ai", "snapshot-legacy", 2), createdAt: "2026-08-15T02:00:00.000Z" },
          { ...summary("verified-a", "snapshot-a", 1), createdAt: "2026-08-15T01:00:00.000Z" },
        ],
      }),
      getEnergySavedAnalysis: vi.fn(async (_projectId: string, analysisId: string) => {
        if (analysisId === "legacy-invalid-ai") {
          throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
        }
        return detail(summary("verified-a", "snapshot-a", 1), snapshot("snapshot-a", "release-a", 1_000));
      }),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Snapshot A:");
    expect(container.textContent).toContain("snapshot-a");
    expect(container.textContent).not.toContain("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
  });

  it("fails closed when a Saved read error only contains the legacy code as wrapped context", async () => {
    const current = snapshot("snapshot-b", "release-b", 1_100);
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({
        items: [
          { ...summary("newer-current-error", "snapshot-newer", 2), createdAt: "2026-08-15T02:00:00.000Z" },
          { ...summary("verified-a", "snapshot-a", 1), createdAt: "2026-08-15T01:00:00.000Z" },
        ],
      }),
      getEnergySavedAnalysis: vi.fn(async (_projectId: string, analysisId: string) => {
        if (analysisId === "newer-current-error") {
          throw new Error("Current Saved read failed after ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID");
        }
        return detail(summary("verified-a", "snapshot-a", 1), snapshot("snapshot-a", "release-a", 1_000));
      }),
    };

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Current Saved read failed");
    expect(container.textContent).not.toContain("Snapshot A:");
  });

  it("traps keyboard focus inside the dialog and restores the opening control on close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open comparison";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const previousItem = summary("saved-a", "snapshot-a", 1);
    const client = {
      listEnergySavedAnalyses: vi.fn().mockResolvedValue({ items: [previousItem] }),
      getEnergySavedAnalysis: vi.fn().mockResolvedValue(
        detail(previousItem, snapshot("snapshot-a", "release-a", 1_000)),
      ),
    };
    const current = snapshot("snapshot-b", "release-b", 1_100);

    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={onClose}
          onOpenPrevious={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const close = buttons[0]!;
    const last = buttons.at(-1)!;
    expect(document.activeElement).toBe(close);
    last.focus();
    await act(async () => {
      root.render(
        <OverviewChangeDialog
          projectId="preschool-demo"
          currentSnapshot={current}
          currentAiArtifact={null}
          client={client}
          onClose={vi.fn()}
          onOpenPrevious={vi.fn()}
        />,
      );
    });
    expect(document.activeElement).toBe(last);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(close);

    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
    root = createRoot(container);
    opener.remove();
  });
});

function summary(id: string, snapshotId: string, sequence: number): EnergySavedAnalysisSummaryDto {
  return {
    id,
    seriesId: "series-1",
    sequence,
    projectId: "preschool-demo",
    scopeId: "project",
    scopeName: "All centres",
    resource: "electricity",
    title: `Overview ${sequence}`,
    templateRevisionId: "template-v1",
    dataSnapshotId: snapshotId,
    createdBy: "admin",
    createdAt: "2026-08-15T00:00:00.000Z",
  };
}

function detail(
  item: EnergySavedAnalysisSummaryDto,
  frozen: EnergyProjectAnalysisSnapshotDto,
): EnergySavedAnalysisDetailDto {
  return {
    ...item,
    snapshot: frozen,
    analysis: frozen.analysis,
  } as unknown as EnergySavedAnalysisDetailDto;
}

function snapshot(
  snapshotId: string,
  releaseId: string,
  usageKwh: number,
  rendererKey: "preschool-overview" | "ngee-ann-overview" = "preschool-overview",
): EnergyProjectAnalysisSnapshotDto {
  return {
    context: {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      from: "2026-05-08T00:00:00.000Z",
      to: "2026-06-05T00:00:00.000Z",
      timezone: "Asia/Singapore",
      userId: "admin",
      workspaceId: "preschool-demo-org",
      projectName: "Preschool Demo",
      scopeName: "All centres",
      scopeType: "project",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "energy-metrics-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-15T00:00:00.000Z",
      dataSnapshotId: snapshotId,
      primaryPeriod: { start: "2026-05-08T00:00:00.000Z", endExclusive: "2026-06-05T00:00:00.000Z" },
      projectReleaseId: releaseId,
    },
    renderer: { key: rendererKey, version: "1", contractVersion: "project-analysis-snapshot@1" },
    projectRelease: { id: releaseId },
    recipe: { id: "energy-scope-analysis", version: "1" },
    dataSnapshot: {
      id: snapshotId,
      importBatchIds: [],
      lastSeenAt: snapshotId === "snapshot-b"
        ? "2026-06-05T00:00:00.000Z"
        : "2026-06-04T00:00:00.000Z",
    },
    analysis: {
      summary: {
        usageKwh,
        averageDailyUsageKwh: usageKwh / 28,
        peakKw: 80,
        nonOperatingSharePct: 10,
      },
    },
  } as unknown as EnergyProjectAnalysisSnapshotDto;
}

function aiArtifact(
  snapshotId: string,
  projectReleaseId: string,
  findings: Array<[title: string, text: string]>,
): EnergySavedAnalysisAiArtifactInputDto {
  const from = "2026-05-08T00:00:00.000Z";
  const to = "2026-06-05T00:00:00.000Z";
  return {
    contract: "energyiq-saved-ai-result@2",
    rendererKey: "preschool-overview",
    snapshotId,
    projectReleaseId,
    result: {
      artifactKind: "preschool-overview-ai-read-model",
      status: "available",
      binding: {
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        scopeId: "project",
        dataSnapshotId: snapshotId,
        projectReleaseId,
        analysisPeriod: { from, to },
        modelProfileId: "workspace-default",
        modelProfileRevision: 8,
      },
      sections: {
        "centre-benchmark": { status: "unavailable", reason: "Not generated." },
        "standby-wastage": { status: "unavailable", reason: "Not generated." },
        "operating-behaviour": { status: "unavailable", reason: "Not generated." },
        "planning-outlook": { status: "unavailable", reason: "Not generated." },
      },
      executive: {
        status: "available",
        artifactId: `executive-${snapshotId}`,
        result: {
          artifactKind: "executive-synthesis",
          status: "available",
          providerProfileId: "workspace-default",
          runId: `run-${snapshotId}`,
          contract: {
            id: "preschool-executive-synthesis",
            revision: "preschool-executive-synthesis-v4",
          },
          binding: {
            workspaceId: "preschool-demo-org",
            projectId: "preschool-demo",
            scopeId: "project",
            dataSnapshotId: snapshotId,
            projectReleaseId,
            analysisPeriod: { from, to },
            modelProfileId: "workspace-default",
            modelProfileRevision: 8,
          },
          sourceSectionArtifactIds: [],
          summary: { text: "Summary", evidenceRefs: ["evidence:summary"] },
          findings: findings.map(([title, text], index) => ({
            id: `finding-${index}`,
            title,
            text,
            sectionIds: ["centre-benchmark"],
            evidenceRefs: [`evidence:${index}`],
          })),
        },
      },
    },
  };
}
