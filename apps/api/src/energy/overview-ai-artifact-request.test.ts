import { describe, expect, it } from "vitest";

import { currentOverviewAiArtifactAnalysisRequest } from "./overview-ai-artifact.js";

describe("Overview AI Artifact analysis identity request", () => {
  it("reuses the current Overview window and exact pins instead of forking a Custom-period cache key", () => {
    const request = currentOverviewAiArtifactAnalysisRequest("ngee-ann-polytechnic", "project", {
      from: "2026-08-01",
      to: "2026-08-19",
      dataSnapshotId: "snapshot-v10",
      projectReleaseId: "release-v10",
    });

    expect(request).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
      from: "2026-08-01",
      to: "2026-08-19",
      expectedDataSnapshotId: "snapshot-v10",
      expectedProjectReleaseId: "release-v10",
    });
    expect(request).not.toHaveProperty("period");
  });
});
