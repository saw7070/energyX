import { describe, expect, it } from "vitest";

import type { EnergyProjectOverviewAiReadModelDto } from "../../../lib/config-api";
import {
  buildTuyaOfficeFindingHref,
  tuyaOfficeAiUnitPresentation,
  tuyaOfficeAiUnitsForRegion,
} from "./tuya-office-project-ai-slots";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";

describe("tuyaOfficeAiUnitPresentation", () => {
  it("projects the full accepted saved Summary and every governed finding", () => {
    expect(tuyaOfficeAiUnitPresentation({
      status: "available",
      artifactId: "artifact-tuya-section",
      result: {
        status: "available",
        summary: {
          text: "Coverage limits the current operational conclusion.",
          evidenceRefs: ["evidence:tuya:coverage"],
          windowId: "current-overview",
        },
        insights: [
          {
            id: "verify-history",
            title: "Verify the incomplete meter history",
            text: "Confirm whether the circuit is unused or its history is incomplete.",
            epistemicStatus: "inferred",
            evidenceRefs: ["evidence:tuya:coverage"],
            windowId: "current-overview",
            deepDiveQuestion: "Is the circuit intentionally idle?",
          },
          { title: "Keep cost conclusions withheld" },
          { title: "Review the next complete day" },
          { title: "Do not render a fourth finding" },
        ],
      },
    })).toEqual({
      summary: "Coverage limits the current operational conclusion.",
      summaryEvidenceRefs: ["evidence:tuya:coverage"],
      summaryWindowIds: ["current-overview"],
      findings: [
        {
          id: "verify-history",
          title: "Verify the incomplete meter history",
          text: "Confirm whether the circuit is unused or its history is incomplete.",
          epistemicStatus: "inferred",
          evidenceRefs: ["evidence:tuya:coverage"],
          windowIds: ["current-overview"],
          sourceSectionIds: [],
          sourceInsightIds: [],
          deepDiveQuestion: "Is the circuit intentionally idle?",
        },
        { id: "finding:1", title: "Keep cost conclusions withheld", evidenceRefs: [], windowIds: [], sourceSectionIds: [], sourceInsightIds: [] },
        { id: "finding:2", title: "Review the next complete day", evidenceRefs: [], windowIds: [], sourceSectionIds: [], sourceInsightIds: [] },
        { id: "finding:3", title: "Do not render a fourth finding", evidenceRefs: [], windowIds: [], sourceSectionIds: [], sourceInsightIds: [] },
      ],
      fallback: "The stored Artifact does not contain a publishable Section interpretation.",
    });
  });

  it("keeps missing and failed units explicit instead of inventing copy", () => {
    expect(tuyaOfficeAiUnitPresentation({ status: "missing" }).fallback)
      .toBe("No saved analysis has been generated for this exact Snapshot.");
    expect(tuyaOfficeAiUnitPresentation({ status: "failed", artifactId: "failed", reason: "VALIDATION_FAILED" }).fallback)
      .toBe("VALIDATION_FAILED");
  });

  it("presents Key Findings and Additional Insights from their governed finding arrays", () => {
    expect(tuyaOfficeAiUnitPresentation({
      status: "available",
      artifactId: "executive",
      result: {
        status: "available",
        summary: {
          text: "Two Sections support a coordinated review.",
          evidenceRefs: ["evidence:tuya:summary"],
        },
        findings: [{
          title: "Coordinate meter readiness and demand checks",
          sectionIds: ["data-readiness", "consumption-and-demand"],
          sourceInsightIds: ["insight:data-readiness", "insight:consumption-and-demand"],
          evidenceRefs: ["evidence:tuya:summary"],
          relationship: {
            relatedPresentedClaimIds: ["section:data-readiness:summary"],
            novelConclusion: "Demand review depends on meter readiness.",
            relationshipAssertion: true,
          },
          origin: {
            kind: "ai-discovery",
            directionMethodResourceIds: ["method:energy-review"],
          },
          alert: { severity: "attention", certainty: "possible", evidenceRefs: ["evidence:tuya:summary"] },
        }],
      },
    })).toMatchObject({
      summary: "Two Sections support a coordinated review.",
      findings: [{
        id: "finding:0",
        title: "Coordinate meter readiness and demand checks",
        evidenceRefs: ["evidence:tuya:summary"],
        windowIds: [],
        sourceSectionIds: ["data-readiness", "consumption-and-demand"],
        sourceInsightIds: ["insight:data-readiness", "insight:consumption-and-demand"],
        relationship: {
          relatedPresentedClaimIds: ["section:data-readiness:summary"],
          novelConclusion: "Demand review depends on meter readiness.",
          relationshipAssertion: true,
        },
        origin: "ai-discovery · method:energy-review",
        alert: {
          severity: "attention",
          certainty: "possible",
          evidenceRefs: ["evidence:tuya:summary"],
        },
      }],
    });
  });

  it("places each unit only in the region compiled from the published Definition", () => {
    const model = {
      surface: {
        keyFindings: { slotId: "key-findings", regionId: "tuya-key-findings", label: "AI Key Findings", order: 0 },
        sections: [{ id: "data-readiness", slotId: "section-data-readiness", regionId: "tuya-circuit-health", label: "Data readiness", order: 10 }],
        additionalInsights: { slotId: "additional-insights", regionId: "tuya-decision-lenses", label: "Additional Insights", order: 40 },
      },
      keyFindings: { status: "missing" },
      sections: { "data-readiness": { status: "missing" } },
      additionalInsights: { status: "missing" },
    } as unknown as EnergyProjectOverviewAiReadModelDto;

    expect(tuyaOfficeAiUnitsForRegion(model, "tuya-key-findings").map(({ key }) => key))
      .toEqual(["key-findings"]);
    expect(tuyaOfficeAiUnitsForRegion(model, "tuya-circuit-health").map(({ key }) => key))
      .toEqual(["section-data-readiness"]);
    expect(tuyaOfficeAiUnitsForRegion(model, "tuya-decision-lenses").map(({ key }) => key))
      .toEqual(["additional-insights"]);
    expect(tuyaOfficeAiUnitsForRegion(model, "tuya-overall-performance")).toEqual([]);
  });

  it("orders all units in one region by the published Definition order instead of role", () => {
    const model = {
      surface: {
        keyFindings: { slotId: "key-findings", regionId: "tuya-key-findings", label: "AI Key Findings", order: 30 },
        sections: [{ id: "data-readiness", slotId: "section-data-readiness", regionId: "tuya-key-findings", label: "Data readiness", order: 10 }],
        additionalInsights: { slotId: "additional-insights", regionId: "tuya-key-findings", label: "Additional Insights", order: 20 },
      },
      keyFindings: { status: "missing" },
      sections: { "data-readiness": { status: "missing" } },
      additionalInsights: { status: "missing" },
    } as unknown as EnergyProjectOverviewAiReadModelDto;

    expect(tuyaOfficeAiUnitsForRegion(model, "tuya-key-findings").map(({ key }) => key))
      .toEqual(["section-data-readiness", "additional-insights", "key-findings"]);
  });

  it("binds an AI Analyst handoff to the exact Artifact, Finding, Evidence and report-time identity", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.context.projectId = "tuya-office";
    snapshot.dataSnapshot.id = "tuya-snapshot-a";
    snapshot.projectRelease.id = "tuya-release-a";
    snapshot.reportTimeContext = {
      contractRevision: "energyiq-report-time-context@1",
      binding: {
        workspaceId: "default",
        projectId: "tuya-office",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "tuya-snapshot-a",
        projectReleaseId: "tuya-release-a",
      },
      timezone: "Asia/Singapore",
      asOf: "2026-06-17T01:00:00.000Z",
      acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
      dataThroughLocalDate: "2026-06-16",
      lastRefreshedAt: "2026-06-17T01:00:00.000Z",
      policyId: "tuya-office-report-time",
      policyRevision: "1",
      windows: [{
        windowId: "current-overview",
        label: "Current Overview",
        phase: "complete",
        from: snapshot.context.from,
        toExclusive: snapshot.context.to,
        completeDayCount: 7,
      }],
    };
    const validReportTimeContext = snapshot.reportTimeContext;
    const finding = tuyaOfficeAiUnitPresentation({
      status: "available",
      artifactId: "artifact-tuya-demand",
      result: {
        status: "available",
        findings: [{
          id: "consumption-and-demand::shared-review",
          title: "Review demand timing",
          text: "Demand timing warrants verification.",
          evidenceRefs: ["evidence:tuya:demand"],
          windowIds: ["current-overview"],
          deepDiveQuestion: "Which systems were active?",
        }],
      },
    }).findings[0]!;

    const href = buildTuyaOfficeFindingHref("/energyiq/ai?comparison=selected", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    });
    expect(href).not.toBeNull();
    const url = new URL(href!, "https://energyiq.test");
    expect(url.searchParams.get("comparison")).toBe("selected");
    expect(url.searchParams.get("period")).toBe("Custom");
    expect(url.searchParams.get("from")).toBe(snapshot.context.from);
    expect(url.searchParams.get("to")).toBe(snapshot.context.to);
    expect(url.searchParams.get("dataSnapshotId")).toBe("tuya-snapshot-a");
    expect(url.searchParams.get("projectReleaseId")).toBe("tuya-release-a");
    expect(JSON.parse(url.searchParams.get("finding")!)).toMatchObject({
      findingId: "consumption-and-demand::shared-review",
      targetId: "consumption-and-demand",
      artifactId: "artifact-tuya-demand",
      howToVerify: "Which systems were active?",
    });
    expect(JSON.parse(url.searchParams.get("evidence")!)).toMatchObject({
      snapshotId: "tuya-snapshot-a",
      projectReleaseId: "tuya-release-a",
      evidenceRefs: ["evidence:tuya:demand"],
      windowIds: ["current-overview"],
      reportTime: { policyId: snapshot.reportTimeContext!.policyId },
      scopeId: snapshot.context.scopeId,
      resource: "electricity",
    });

    finding.evidenceRefs = Array.from({ length: 8 }, (_, index) => `evidence:tuya:${index + 1}`);
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).not.toBeNull();
    finding.evidenceRefs.push("evidence:tuya:9");
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).toBeNull();
    finding.evidenceRefs = ["evidence:tuya:demand"];

    finding.id = "f".repeat(200);
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).not.toBeNull();
    finding.id = "f".repeat(201);
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).toBeNull();
    finding.id = "consumption-and-demand::shared-review";

    const validReportWindow = { ...snapshot.reportTimeContext!.windows[0]! };
    snapshot.reportTimeContext!.windows = Array.from({ length: 8 }, (_, index) => ({
      ...snapshot.reportTimeContext!.windows[0]!,
      windowId: `window-${index + 1}`,
      label: "w".repeat(800),
    }));
    finding.windowIds = ["window-1"];
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).toBeNull();
    snapshot.reportTimeContext!.windows = [validReportWindow];
    finding.windowIds = ["current-overview"];

    snapshot.reportTimeContext = undefined;
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).toBeNull();

    snapshot.reportTimeContext = {
      ...ngeeAnnGoldenSnapshot().reportTimeContext!,
      binding: {
        workspaceId: "default",
        projectId: "tuya-office",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "tuya-snapshot-a",
        projectReleaseId: "tuya-release-a",
      },
      windows: [{
        windowId: "another-window",
        label: "Another Window",
        phase: "complete",
        from: snapshot.context.from,
        toExclusive: snapshot.context.to,
        completeDayCount: 7,
      }],
    };
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding,
      snapshot,
    })).toBeNull();

    snapshot.reportTimeContext = validReportTimeContext;
    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding: { ...finding, deepDiveQuestion: undefined },
      snapshot,
    })).toBeNull();

    expect(buildTuyaOfficeFindingHref("/energyiq/ai", {
      artifactId: "artifact-tuya-demand",
      targetId: "consumption-and-demand",
      finding: { ...finding, deepDiveQuestion: "x".repeat(801) },
      snapshot,
    })).toBeNull();
  });
});
