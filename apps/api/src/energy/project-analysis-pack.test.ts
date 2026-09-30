import { describe, expect, it } from "vitest";

import type { EnergyQueryContext } from "./energy-query-context.js";
import { createProjectAnalysisPackContextItem } from "./project-analysis-pack.js";

const context: EnergyQueryContext = {
  userId: "user-1",
  workspaceId: "workspace-1",
  projectId: "ngee-ann-polytechnic",
  projectName: "Ngee Ann Polytechnic",
  scopeId: "ngee-ann-polytechnic",
  scopeName: "Ngee Ann Polytechnic",
  scopeType: "project",
  resource: "electricity",
  timezone: "Asia/Singapore",
  from: "2026-05-19T16:00:00.000Z",
  to: "2026-06-16T16:00:00.000Z",
  endExclusive: true,
  period: "Custom",
  hierarchyRevisionId: "hierarchy-v1",
  meterMappingRevisionId: "meter-routing-v1",
  meterFormulaRevisionId: "formula-v1",
  dataSnapshotId: "snapshot-v1",
  metricVersion: "metrics-v1",
  businessCalendarVersion: "calendar-v1",
  tariffScheduleVersion: "tariff-v1",
  resolvedAt: "2026-06-17T00:00:00.000Z",
};

const preschoolContext: EnergyQueryContext = {
  ...context,
  workspaceId: "preschool-demo-org",
  projectId: "preschool-demo",
  projectName: "Preschool Portfolio",
  scopeId: "preschool-project",
  scopeName: "Preschool Portfolio",
  hierarchyRevisionId: "preschool-hierarchy-v6",
  meterMappingRevisionId: "preschool-mapping-v2",
  dataSnapshotId: "preschool-snapshot-may-2026",
  businessCalendarVersion: "preschool-calendar-v1",
};

describe("createProjectAnalysisPackContextItem", () => {
  it("materializes the server-selected Ngee Ann Pack as a traceable authoritative source", () => {
    const item = createProjectAnalysisPackContextItem({
      context,
      release: {
        id: "release-ngee-ann-v1",
        projectId: context.projectId,
        renderer: { key: "ngee-ann-overview", version: "1" },
      },
      sessionId: "session-1",
    });

    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      id: "project-analysis-pack:ngee-ann-analysis-pack@v1:release-ngee-ann-v1",
      sourceType: "project-analysis-pack",
      sourceId: "ngee-ann-analysis-pack@v1",
      groupId: "project-analysis-pack:ngee-ann-analysis-pack@v1",
      trust: "tool",
      visibility: "model",
      metadata: {
        analysisPackId: "ngee-ann-analysis-pack",
        analysisPackRevision: "v1",
        sourceOwner: "server",
        exclusivityKey: "project-analysis-pack",
        projectReleaseId: "release-ngee-ann-v1",
      },
    });
    const content = String(item?.content);
    expect(content).toContain("analysis_pack_revision=v1");
    expect(content).toContain("project_release_id=release-ngee-ann-v1");
    expect(content).toContain("supports, challenges, or is independent");
    expect(content).toContain("1-day short-term movement");
    expect(content).toContain("Daily averages require complete days");
    expect(content).toContain("official_aggregation_eligible");
    expect(content).toContain("official totals only from eligible rows");
    expect(content).toContain("Non-eligible breakdown rows may explain the official total but must never be added to it");
    expect(content).toContain("what happened");
    expect(content).toContain("AI proposals");
    expect(content).not.toContain("SQL");
    expect(content).not.toContain("```sql");
    expect(content).not.toContain("kWh");
    expect(content).not.toContain("threshold");
    expect(content).not.toContain("formula");
  });

  it("materializes the server-selected Preschool Pack without embedding answers or calculation logic", () => {
    const item = createProjectAnalysisPackContextItem({
      context: preschoolContext,
      release: {
        id: "preschool-release-v2",
        projectId: preschoolContext.projectId,
        renderer: { key: "preschool-overview", version: "1" },
      },
      sessionId: "session-preschool",
    });

    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      id: "project-analysis-pack:preschool-analysis-pack@v1:preschool-release-v2",
      sourceType: "project-analysis-pack",
      sourceId: "preschool-analysis-pack@v1",
      groupId: "project-analysis-pack:preschool-analysis-pack@v1",
      trust: "tool",
      visibility: "model",
      metadata: {
        analysisPackId: "preschool-analysis-pack",
        analysisPackRevision: "v1",
        sourceOwner: "server",
        projectReleaseId: "preschool-release-v2",
        rendererKey: "preschool-overview",
      },
    });
    const content = String(item?.content);
    expect(content).toContain("Portfolio");
    expect(content).toContain("Centre");
    expect(content).toContain("EUI");
    expect(content).toContain("per-pax");
    expect(content).toContain("P75");
    expect(content).toContain("standby");
    expect(content).toContain("operating");
    expect(content).toContain("Circuit");
    expect(content).toContain("Missing Evidence");
    expect(content).not.toContain("SQL");
    expect(content).not.toContain("kWh");
    expect(content).not.toContain("threshold");
    expect(content).not.toContain("formula");
  });

  it("does not bind the Pack to another renderer or Project", () => {
    expect(createProjectAnalysisPackContextItem({
      context,
      release: {
        id: "release-generic-v1",
        projectId: context.projectId,
        renderer: { key: "generic-overview", version: "1" },
      },
      sessionId: "session-1",
    })).toBeNull();

    const otherProject = { ...context, projectId: "preschool-demo" };
    expect(createProjectAnalysisPackContextItem({
      context: otherProject,
      release: {
        id: "release-preschool-v1",
        projectId: otherProject.projectId,
        renderer: { key: "ngee-ann-overview", version: "1" },
      },
      sessionId: "session-1",
    })).toBeNull();
  });

  it("fails closed when the release does not belong to the authorized Project", () => {
    expect(() => createProjectAnalysisPackContextItem({
      context,
      release: {
        id: "release-other-v1",
        projectId: "other-project",
        renderer: { key: "ngee-ann-overview", version: "1" },
      },
      sessionId: "session-1",
    })).toThrow("ENERGYIQ_PROJECT_ANALYSIS_PACK_RELEASE_MISMATCH");
  });
});
