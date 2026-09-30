/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configApi, type EnergySavedAnalysisSummaryDto } from "../../../lib/config-api";
import { SavedAnalysisHistory } from "./saved-analysis-history";

const activeProject = vi.hoisted(() => ({
  id: "preschool-demo",
  name: "Preschool Demo",
  workspaceId: "workspace-1",
  status: "published" as const,
  timezone: "Asia/Singapore",
}));

vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => ({ activeProject }),
}));

describe("SavedAnalysisHistory dialog mode", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists only the active Project versions and opens the selected result in place", async () => {
    const item = savedItem();
    const load = vi.spyOn(configApi, "listEnergySavedAnalyses").mockResolvedValue({ items: [item] });
    const onSelect = vi.fn<(analysisId: string) => void>();

    await act(async () => {
      root.render(<SavedAnalysisHistory presentation="dialog" onSelect={onSelect} />);
    });

    const version = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Version 2"));
    expect(load).toHaveBeenCalledWith("preschool-demo");
    expect(version).toBeTruthy();

    await act(async () => version?.click());
    expect(onSelect).toHaveBeenCalledWith(item.id);
  });
});

function savedItem(): EnergySavedAnalysisSummaryDto {
  return {
    id: "saved-analysis-2",
    seriesId: "series-1",
    sequence: 2,
    projectId: "preschool-demo",
    scopeId: "project",
    scopeName: "Preschool Demo",
    resource: "electricity",
    title: "Preschool Demo · May 2026",
    templateRevisionId: "release-2",
    dataSnapshotId: "snapshot-2",
    createdBy: "user-1",
    createdAt: "2026-08-07T12:00:00.000Z",
  };
}
