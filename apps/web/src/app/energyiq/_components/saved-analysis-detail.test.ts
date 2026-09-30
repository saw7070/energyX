import { describe, expect, it } from "vitest";

import { savedAnalysisExplorerHref } from "./saved-analysis-detail";

describe("Saved Analysis Explorer handoff", () => {
  const input = {
    projectId: "preschool-demo",
    scopeId: "preschool-centre-a",
    resource: "electricity" as const,
    from: "2026-04-30T16:00:00.000Z",
    to: "2026-05-31T16:00:00.000Z",
    timezone: "Asia/Singapore",
    dataSnapshotId: "snapshot-saved-a",
    projectReleaseId: "release-saved-a",
  };

  it("pins frozen inspection to the saved period, Snapshot and Release", () => {
    expect(savedAnalysisExplorerHref(input, "frozen")).toBe(
      "/energyiq/explorer?projectId=preschool-demo&scopeId=preschool-centre-a&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&dataSnapshotId=snapshot-saved-a&projectReleaseId=release-saved-a",
    );
  });

  it("only drops Snapshot and Release pins after the user chooses Current facts", () => {
    expect(savedAnalysisExplorerHref(input, "current")).toBe(
      "/energyiq/explorer?projectId=preschool-demo&scopeId=preschool-centre-a&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31",
    );
  });
});
