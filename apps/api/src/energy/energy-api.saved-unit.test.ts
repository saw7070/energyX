import { describe, expect, it } from "vitest";

import type { PreschoolOverviewAiReadModel } from "./preschool-overview-ai-contracts.js";
import { validPreschoolSavedUnit } from "./energy-api.js";

const binding: PreschoolOverviewAiReadModel["binding"] = {
  workspaceId: "preschool-demo-org",
  projectId: "preschool-demo",
  scopeId: "project",
  dataSnapshotId: "snapshot-b",
  projectReleaseId: "release-b",
  analysisPeriod: {
    from: "2026-05-01T00:00:00.000Z",
    to: "2026-06-01T00:00:00.000Z",
  },
  modelProfileId: "profile-deepseek",
  modelProfileRevision: 8,
};

const executiveUnit = (result: Record<string, unknown>) => ({
  status: result.status,
  artifactId: "executive-artifact",
  result: {
    artifactKind: "executive-synthesis",
    providerProfileId: binding.modelProfileId,
    runId: "executive-run",
    binding,
    sourceSectionArtifactIds: ["section-benchmark"],
    ...result,
  },
});

describe("Preschool Saved Analysis unit validation", () => {
  it("accepts the current V4 Executive shape", () => {
    expect(validPreschoolSavedUnit(executiveUnit({
      status: "available",
      contract: {
        id: "preschool-executive-synthesis",
        revision: "preschool-executive-synthesis-v4",
      },
      summary: {
        text: "Centre H is the clearest peer contrast.",
        evidenceRefs: ["benchmark:centre:h"],
      },
      findings: [{
        id: "finding-h",
        title: "Centre H deserves a separate review",
        text: "Its per-person result differs from its floor-area result.",
        sectionIds: ["centre-benchmark"],
        evidenceRefs: ["benchmark:centre:h"],
      }],
    }), binding, "executive-synthesis")).toBe(true);
  });

  it("rejects a V4 Executive carrying only the legacy keyFindings shape", () => {
    expect(validPreschoolSavedUnit(executiveUnit({
      status: "available",
      contract: {
        id: "preschool-executive-synthesis",
        revision: "preschool-executive-synthesis-v4",
      },
      keyFindings: [],
    }), binding, "executive-synthesis")).toBe(false);
  });

  it("accepts a current V4 empty Executive without inventing a summary", () => {
    expect(validPreschoolSavedUnit(executiveUnit({
      status: "empty",
      contract: {
        id: "preschool-executive-synthesis",
        revision: "preschool-executive-synthesis-v4",
      },
      findings: [],
    }), binding, "executive-synthesis")).toBe(true);
  });

  it("keeps historical V3 Executive Saved Analysis compatible", () => {
    expect(validPreschoolSavedUnit(executiveUnit({
      status: "available",
      contract: {
        id: "preschool-executive-synthesis",
        revision: "preschool-executive-synthesis-v1",
      },
      keyFindings: [],
    }), binding, "executive-synthesis")).toBe(true);
  });
});
