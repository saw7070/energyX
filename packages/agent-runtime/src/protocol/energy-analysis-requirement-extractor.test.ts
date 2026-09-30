import { describe, expect, it } from "vitest";

import { createEnergyAnalysisRequirementExtractor } from "./model-analysis-requirement-extractor.js";

describe("EnergyIQ analysis requirement extraction", () => {
  it("keeps the exact customer question without a model paraphrase", async () => {
    const extract = createEnergyAnalysisRequirementExtractor();

    await expect(extract({
      userText: "How many Active Aging Centers are there?"
    })).resolves.toMatchObject([{
      id: "R1",
      kind: "validation",
      description: "How many Active Aging Centers are there?"
    }]);
  });

  it("pre-binds sufficient immutable package facts before protocol routing", async () => {
    const extract = createEnergyAnalysisRequirementExtractor({
      contract: "analysis-context-evidence@1",
      sourceId: "project-analysis-snapshot:project-1:snapshot-1",
      pins: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        scopeId: "project",
        dataSnapshotId: "snapshot-1",
        dataCutoff: "2026-06-01T00:00:00.000Z",
        projectReleaseId: "release-1",
        metricVersion: "metrics-1",
      },
      facts: [{
        id: "analysis.summary.usage_kwh",
        label: "Total usage",
        metricId: "energy.usage_kwh",
        value: 24921.81,
        unit: "kWh",
        status: "confirmed",
        dimensions: {},
        evidenceRefs: ["evidence-total"],
      }],
    });

    await expect(extract({ userText: "What is the total energy usage?" })).resolves.toMatchObject([{
      description: "What is the total energy usage?",
      contextEvidence: {
        mode: "sufficient",
        factIds: ["analysis.summary.usage_kwh"],
      },
    }]);
  });
});
