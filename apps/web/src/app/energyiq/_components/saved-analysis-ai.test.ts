import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configApi,
  type EnergyProjectOverviewAiReadModelDto,
} from "../../../lib/config-api";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { runSavedAnalysisAiForSnapshot } from "./saved-analysis-ai";

describe("Saved Analysis Project AI", () => {
  afterEach(() => vi.restoreAllMocks());

  it("freezes the exact terminal Ngee Ann Layer 1-3 read model without starting generation", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const model = readModel(snapshot);
    const read = vi.spyOn(configApi, "getEnergyProjectOverviewAiReadModel").mockResolvedValue(model);

    await expect(runSavedAnalysisAiForSnapshot(snapshot)).resolves.toEqual({
      contract: "energyiq-saved-ai-result@3",
      rendererKey: "ngee-ann-overview",
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      result: model,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(snapshot.context.projectId, snapshot.context.scopeId);
  });

  it("refuses a stale or incomplete read model instead of saving it under the current Snapshot", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const stale = readModel(snapshot);
    stale.binding.dataSnapshotId = "snapshot-stale";
    const read = vi.spyOn(configApi, "getEnergyProjectOverviewAiReadModel")
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({
        ...readModel(snapshot),
        sections: {
          ...readModel(snapshot).sections,
          "time-behaviour": { status: "running", artifactId: "artifact:time" },
        },
      });

    await expect(runSavedAnalysisAiForSnapshot(snapshot)).resolves.toBeNull();
    await expect(runSavedAnalysisAiForSnapshot(snapshot)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not offer a Saved AI attachment when every unit only failed or is unavailable", async () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const failed = readModel(snapshot);
    failed.keyFindings = { status: "failed", artifactId: "artifact:executive", reason: "failed" };
    failed.sections = Object.fromEntries(Object.keys(failed.sections).map((sectionId) => [
      sectionId,
      { status: "failed", artifactId: `artifact:${sectionId}`, reason: "failed" },
    ]));
    failed.additionalInsights = { status: "unavailable", reason: "unavailable" };
    vi.spyOn(configApi, "getEnergyProjectOverviewAiReadModel").mockResolvedValue(failed);

    await expect(runSavedAnalysisAiForSnapshot(snapshot)).resolves.toBeNull();
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
  keyFindings: availableUnit("executive"),
  sections: Object.fromEntries([
    "trend-and-demand",
    "time-behaviour",
    "circuit-concentration",
    "decision-priorities",
  ].map((sectionId) => [sectionId, availableUnit(sectionId)])),
  additionalInsights: availableUnit("additional"),
});

const availableUnit = (id: string) => ({
  status: "available" as const,
  artifactId: `artifact:${id}`,
  result: { status: "available", runId: `run:${id}`, findings: [] },
});
