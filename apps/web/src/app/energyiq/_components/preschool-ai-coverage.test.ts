import { describe, expect, it } from "vitest";

import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import { buildPreschoolOverviewCoverage } from "./preschool-ai-coverage";

describe("Preschool Overview Coverage adapter", () => {
  it("binds visible Section coverage to the exact published Snapshot and cutoff", () => {
    const snapshot = preschoolGoldenSnapshot();
    const coverage = buildPreschoolOverviewCoverage(snapshot);

    expect(coverage).toMatchObject({
      contract: { id: "preschool-overview-coverage", revision: "v1" },
      binding: {
        projectId: "preschool-demo",
        scopeId: snapshot.context.scopeId,
        dataSnapshotId: snapshot.dataSnapshot.id,
        projectReleaseId: snapshot.projectRelease.id,
        dataCutoff: snapshot.context.primaryPeriod.endExclusive,
        outputContractRevision: "v13",
      },
    });
    expect(coverage?.sections.map((section) => section.target)).toEqual([
      "preschool.overall-key-findings",
      "preschool.benchmark",
      "preschool.standby",
      "preschool.operating-hours",
      "preschool.forecast",
      "cross-section",
    ]);
    expect(coverage?.sections.find((section) => section.target === "preschool.benchmark")).toMatchObject({
      visibleSignalRefs: ["efficiency"],
      visibleEvidenceRefs: expect.arrayContaining(["benchmark:portfolio-p75"]),
      visibleClaims: expect.arrayContaining([
        expect.objectContaining({ id: "efficiency" }),
        expect.objectContaining({ id: "visible-evidence:benchmark:portfolio-p75" }),
      ]),
      visibleVisuals: [expect.objectContaining({
        id: "preschool.benchmark:normalised-centre-ranking",
        type: "ranking",
        claimRefs: expect.arrayContaining(["preschoolBenchmark.priorityCentreCodes"]),
      })],
    });
    const overall = coverage?.sections.find((section) => section.target === "preschool.overall-key-findings");
    expect(overall?.visibleSignalRefs).toEqual(expect.arrayContaining(["efficiency", "after-hours", "operating"]));
    expect(overall?.visibleVisuals.map((visual) => visual.id)).toEqual(expect.arrayContaining([
      "preschool.overall:portfolio-kpis",
      "preschool.benchmark:normalised-centre-ranking",
      "preschool.standby:calendar-energy-split",
      "preschool.operating-hours:spike-and-sop-table",
      "preschool.forecast:appliance-contribution",
    ]));
  });

  it("fails closed when the Section facts are pinned to another Snapshot", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolDecisionSignals!.context.dataSnapshotId = "stale-snapshot";

    expect(buildPreschoolOverviewCoverage(snapshot)).toBeNull();
  });
});
