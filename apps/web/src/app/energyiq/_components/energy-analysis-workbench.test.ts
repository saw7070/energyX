import { describe, expect, it } from "vitest";

import {
  buildEnergyAiHandoffInitialDraftPrompt,
  energyQueryContextRequestFromSearchParams,
  toEnergyAnalysisExternalContext,
} from "./energy-analysis-workbench";

describe("EnergyX AI Analyst handoff", () => {
  it("pins an Overview handoff to the exact Snapshot, Release and 28-day Period", () => {
    const params = new URLSearchParams({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-20",
      to: "2026-06-16",
      dataSnapshotId: "snapshot-b",
      projectReleaseId: "release-b",
    });

    expect(energyQueryContextRequestFromSearchParams(params, "preschool-demo")).toEqual({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-20",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-b",
      expectedProjectReleaseId: "release-b",
    });
  });

  it.each([
    "preschool-demo",
    "ngee-ann-polytechnic",
    "tuya-office",
    "future-project",
  ])("uses the server-owned all-available data domain for direct AI entry to %s", (projectId) => {
    expect(energyQueryContextRequestFromSearchParams(
      new URLSearchParams({ projectId }),
      projectId,
    )).toEqual({
      projectId,
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "all-available",
    });
  });

  it("keeps the direct AI URL Project authoritative over a stale active Project", () => {
    expect(energyQueryContextRequestFromSearchParams(
      new URLSearchParams({ projectId: "preschool-demo" }),
      "tuya-office",
    )).toMatchObject({
      projectId: "preschool-demo",
      analysisWindow: "all-available",
    });
  });

  it("projects the server-resolved Snapshot and data cutoff into the visible Analyst context", () => {
    const context = toEnergyAnalysisExternalContext({
      userId: "user-1",
      workspaceId: "workspace-1",
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Whole project",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-05-19T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-1",
      meterMappingRevisionId: "mapping-1",
      meterFormulaRevisionId: "formula-1",
      dataSnapshotId: "snapshot-1",
      projectReleaseId: "release-1",
      metricVersion: "metric-1",
      businessCalendarVersion: "calendar-1",
      tariffScheduleVersion: "tariff-1",
      resolvedAt: "2026-08-06T00:00:00.000Z",
    });

    expect(context).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "ngee-ann-polytechnic",
      period: "Custom",
      from: "2026-05-19T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
      dataCutoff: "2026-06-16",
      dataSnapshotId: "snapshot-1",
      expectedDataSnapshotId: "snapshot-1",
      expectedProjectReleaseId: "release-1",
      expectedHierarchyRevisionId: "hierarchy-1",
      expectedMeterMappingRevisionId: "mapping-1",
      expectedMeterFormulaRevisionId: "formula-1",
    });
  });

  it("turns bounded Finding and Evidence URL parameters into an untrusted verification draft", () => {
    const params = new URLSearchParams({
      projectId: "ngee-ann-polytechnic",
      finding: JSON.stringify({
        title: "Recurring overnight load",
        what: "The pattern recurs across recent periods.",
        why: { kind: "Hypothesis", text: "Operating-state evidence is incomplete." },
        how: "Inspect the coincident circuits.",
        howToVerify: "Compare the next complete period after the check.",
      }),
      evidence: JSON.stringify({
        snapshotId: "snapshot-1",
        dataCutoff: "2026-06-16",
        note: "SQL supports the pattern, not the operational cause.",
        toolCallIds: ["sql-1"],
        auditLogIds: ["audit-sql-1"],
      }),
    });

    const prompt = buildEnergyAiHandoffInitialDraftPrompt(params);

    expect(prompt).toContain("untrusted draft");
    expect(prompt).toContain("Recurring overnight load");
    expect(prompt).toContain("Hypothesis");
    expect(prompt).toContain("snapshot-1");
    expect(prompt).toContain("sql-1");
    expect(prompt).toContain("current authorized Project, Scope, resource, and Snapshot");
    expect(prompt).toContain("scoped read-only SQL Evidence");
    expect(prompt).toContain("Missing Evidence");
  });

  it("accepts a deterministic-only Overview finding and keeps it subject to verification", () => {
    const params = new URLSearchParams({
      projectId: "preschool-demo",
      finding: JSON.stringify({
        title: "Standby is a separate angle",
        what: "A scoped pattern is visible.",
        why: { kind: "Hypothesis", text: "The cited Evidence supports an investigation." },
        how: "Inspect the operating context and leading Circuit.",
        howToVerify: "Repeat the same scoped comparison after investigation.",
      }),
      evidence: JSON.stringify({
        snapshotId: "snapshot-1",
        dataCutoff: "2026-05-31",
        note: "This is not a confirmed root cause.",
        deterministicEvidenceIds: ["operating:portfolio"],
        toolCallIds: [],
        auditLogIds: [],
      }),
    });

    const prompt = buildEnergyAiHandoffInitialDraftPrompt(params);

    expect(prompt).toContain("Standby is a separate angle");
    expect(prompt).toContain("Deterministic Evidence IDs: operating:portfolio");
    expect(prompt).toContain("Tool call IDs: not supplied");
    expect(prompt).toContain("scoped read-only SQL Evidence");
  });

  it("turns a typed Section Insight handoff into an executable Evidence re-resolution draft", () => {
    const params = new URLSearchParams({
      projectId: "preschool-demo",
      finding: JSON.stringify({
        kind: "section-insight",
        insightId: "standby-schedule-mismatch",
        sectionId: "standby-wastage",
        artifactId: "section-standby-v4",
        runId: "run-standby-v4",
        title: "Schedule mismatch may contribute",
        what: "Closed-hour load recurs near the published closing boundary.",
        deepDiveQuestion: "Which Centres show recurring closed-hour load near the published closing boundary?",
      }),
      evidence: JSON.stringify({
        snapshotId: "preschool-26b85b9c0b95e090",
        projectReleaseId: "legacy-profile:preschool-demo:2",
        period: {
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
        },
        evidenceRefs: ["standby:closing-boundary"],
        reportTime: {
          policyId: "preschool-report-time",
          policyRevision: "v1",
          timezone: "Asia/Singapore",
          dataThroughLocalDate: "2026-05-31",
          windows: [{
            windowId: "current-overview",
            label: "Current Overview",
            phase: "complete",
            from: "2026-04-30T16:00:00.000Z",
            toExclusive: "2026-05-31T16:00:00.000Z",
            completeDayCount: 31,
          }],
        },
      }),
    });

    const prompt = buildEnergyAiHandoffInitialDraftPrompt(params);

    expect(prompt).toContain("Which Centres show recurring closed-hour load near the published closing boundary?");
    expect(prompt).toContain("Section: standby-wastage");
    expect(prompt).toContain("Artifact: section-standby-v4");
    expect(prompt).toContain("Run: run-standby-v4");
    expect(prompt).toContain("Snapshot reference: preschool-26b85b9c0b95e090");
    expect(prompt).toContain("Project Release reference: legacy-profile:preschool-demo:2");
    expect(prompt).toContain("Cited Evidence refs: standby:closing-boundary");
    expect(prompt).toContain("Report window current-overview");
    expect(prompt).toContain("re-resolve the cited Evidence refs");
    expect(prompt).not.toContain("Data cutoff reference");
    expect(prompt).not.toContain("Deterministic Evidence IDs");
    expect(prompt).not.toContain("Tool call IDs");
    expect(prompt).not.toContain("Audit log IDs");
  });

  it("restores a Tuya Overview Finding handoff with exact Artifact and Evidence identity", () => {
    const params = new URLSearchParams({
      projectId: "tuya-office",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-08-24T16:00:00.000Z",
      to: "2026-08-31T16:00:00.000Z",
      dataSnapshotId: "tuya-snapshot-30",
      projectReleaseId: "tuya-release-30",
      finding: JSON.stringify({
        kind: "tuya-overview-finding",
        findingId: "consumption-and-demand::review-demand",
        targetId: "consumption-and-demand",
        artifactId: "artifact-tuya-demand",
        title: "Review demand timing",
        what: "Demand timing warrants verification.",
        howToVerify: "Which systems were active?",
      }),
      evidence: JSON.stringify({
        snapshotId: "tuya-snapshot-30",
        projectReleaseId: "tuya-release-30",
        scopeId: "project",
        resource: "electricity",
        period: { from: "2026-08-24T16:00:00.000Z", to: "2026-08-31T16:00:00.000Z" },
        evidenceRefs: ["evidence:tuya:demand"],
        windowIds: ["current-overview"],
        reportTime: {
          contractRevision: "energyiq-report-time-context@1",
          binding: {
            projectId: "tuya-office",
            scopeId: "project",
            resource: "electricity",
            dataSnapshotId: "tuya-snapshot-30",
            projectReleaseId: "tuya-release-30",
          },
          policyId: "tuya-office-report-time",
          policyRevision: "1",
          timezone: "Asia/Singapore",
          acceptedDataEndExclusive: "2026-08-31T16:00:00.000Z",
          dataThroughLocalDate: "2026-08-31",
          windows: [{ windowId: "current-overview", label: "Current Overview", phase: "complete", from: "2026-08-24T16:00:00.000Z", toExclusive: "2026-08-31T16:00:00.000Z", completeDayCount: 7 }],
        },
      }),
    });

    expect(energyQueryContextRequestFromSearchParams(params, "tuya-office")).toMatchObject({
      period: "Custom",
      expectedDataSnapshotId: "tuya-snapshot-30",
      expectedProjectReleaseId: "tuya-release-30",
    });
    const prompt = buildEnergyAiHandoffInitialDraftPrompt(params);
    expect(prompt).toContain("Which systems were active?");
    expect(prompt).toContain("Artifact: artifact-tuya-demand");
    expect(prompt).toContain("Finding: consumption-and-demand::review-demand");
    expect(prompt).toContain("Snapshot reference: tuya-snapshot-30");
    expect(prompt).toContain("Project Release reference: tuya-release-30");
    expect(prompt).toContain("Report window current-overview");
    expect(prompt).toContain("Cited Evidence refs: evidence:tuya:demand");

    params.set("dataSnapshotId", "foreign-snapshot");
    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
    params.set("dataSnapshotId", "tuya-snapshot-30");

    params.set("scopeId", "foreign-scope");
    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
    params.set("scopeId", "project");

    const evidence = JSON.parse(params.get("evidence")!) as Record<string, unknown>;
    params.set("evidence", JSON.stringify({ ...evidence, reportTime: undefined }));
    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
    params.set("evidence", JSON.stringify({ ...evidence, windowIds: ["unbound-window"] }));
    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
    params.set("evidence", JSON.stringify(evidence));

    params.set("resource", "gas");
    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
  });

  it.each([
    {
      name: "a missing Artifact identity",
      finding: { insightId: "insight-1", sectionId: "standby-wastage", runId: "run-1", deepDiveQuestion: "What changed?" },
      evidence: { snapshotId: "snapshot-1", projectReleaseId: "release-1", period: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" }, evidenceRefs: ["evidence-1"] },
    },
    {
      name: "a missing Project Release identity",
      finding: { insightId: "insight-1", sectionId: "standby-wastage", artifactId: "artifact-1", runId: "run-1", deepDiveQuestion: "What changed?" },
      evidence: { snapshotId: "snapshot-1", period: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" }, evidenceRefs: ["evidence-1"] },
    },
    {
      name: "no cited Evidence refs",
      finding: { insightId: "insight-1", sectionId: "standby-wastage", artifactId: "artifact-1", runId: "run-1", deepDiveQuestion: "What changed?" },
      evidence: { snapshotId: "snapshot-1", projectReleaseId: "release-1", period: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" }, evidenceRefs: [] },
    },
    {
      name: "a non-increasing Period",
      finding: { insightId: "insight-1", sectionId: "standby-wastage", artifactId: "artifact-1", runId: "run-1", deepDiveQuestion: "What changed?" },
      evidence: { snapshotId: "snapshot-1", projectReleaseId: "release-1", period: { from: "2026-06-01T00:00:00.000Z", to: "2026-05-01T00:00:00.000Z" }, evidenceRefs: ["evidence-1"] },
    },
  ])("fails soft for a typed Section Insight with $name", ({ finding, evidence }) => {
    const params = new URLSearchParams({
      finding: JSON.stringify({ kind: "section-insight", ...finding }),
      evidence: JSON.stringify(evidence),
    });

    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
  });

  it.each([
    { name: "missing Evidence", finding: JSON.stringify({ title: "Finding" }), evidence: null },
    { name: "invalid Finding JSON", finding: "{broken", evidence: JSON.stringify({ snapshotId: "snapshot-1" }) },
    { name: "oversized Finding", finding: JSON.stringify({ title: "x".repeat(8_100) }), evidence: JSON.stringify({ snapshotId: "snapshot-1" }) },
    { name: "invalid Evidence shape", finding: JSON.stringify({ title: "Finding", what: "What", why: { kind: "Evidence", text: "Why" }, how: "How", howToVerify: "Verify" }), evidence: JSON.stringify({ snapshotId: 42 }) },
  ])("fails soft for $name", ({ finding, evidence }) => {
    const params = new URLSearchParams();
    params.set("finding", finding);
    if (evidence !== null) params.set("evidence", evidence);

    expect(buildEnergyAiHandoffInitialDraftPrompt(params)).toBeNull();
  });
});
