import { describe, expect, it } from "vitest";

import type { EnergyQueryContextDto, SessionEnergyContextDto } from "../../../lib/config-api";
import {
  decideEnergySessionContextRestore,
  energySessionContextStatus,
  freshEnergyAnalysisTaskHref,
  restoredEnergySessionHref,
} from "./energy-session-context";

const historical: SessionEnergyContextDto = {
  sourceRunId: "run-1",
  workspaceId: "workspace-ngee-ann",
  projectId: "ngee-ann-polytechnic",
  projectName: "Ngee Ann Polytechnic",
  scopeId: "project",
  scopeName: "Ngee Ann Polytechnic",
  scopeType: "project",
  resource: "electricity",
  timezone: "Asia/Singapore",
  from: "2026-06-02T16:00:00.000Z",
  to: "2026-06-09T16:00:00.000Z",
  hierarchyRevisionId: "hierarchy-1",
  meterMappingRevisionId: "mapping-1",
  meterFormulaRevisionId: "formula-1",
  projectReleaseId: "release-1",
  dataSnapshotId: "snapshot-a",
};

describe("restoredEnergySessionHref", () => {
  it("preserves sub-day half-open ISO boundaries exactly", () => {
    const href = restoredEnergySessionHref(
      "/energyiq/ai",
      new URLSearchParams("scopeId=project&resource=electricity"),
      {
        ...historical,
        from: "2026-06-03T00:15:00.000Z",
        to: "2026-06-03T00:45:00.000Z",
      },
    );
    const restored = new URL(href!, "https://energyiq.local").searchParams;

    expect(restored.get("from")).toBe("2026-06-03T00:15:00.000Z");
    expect(restored.get("to")).toBe("2026-06-03T00:45:00.000Z");
  });

  it("restores the historical exact half-open window after workspace navigation reset it", () => {
    const href = restoredEnergySessionHref(
      "/energyiq/ai",
      new URLSearchParams("scopeId=project&resource=electricity"),
      historical,
    );
    const url = new URL(href!, "https://energyiq.local");

    expect(url.pathname).toBe("/energyiq/ai");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      projectId: "ngee-ann-polytechnic",
      period: "Custom",
      from: historical.from,
      to: historical.to,
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-1",
    });
  });

  it("does not navigate when the URL already represents the historical context", () => {
    expect(restoredEnergySessionHref(
      "/energyiq/ai",
      new URLSearchParams(`projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=${historical.from}&to=${historical.to}&dataSnapshotId=snapshot-a&projectReleaseId=release-1`),
      historical,
    )).toBeNull();
  });
});

describe("freshEnergyAnalysisTaskHref", () => {
  it("releases historical time and Evidence pins while preserving the active data domain", () => {
    expect(freshEnergyAnalysisTaskHref(
      "/energyiq/ai",
      new URLSearchParams({
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        resource: "electricity",
        period: "Custom",
        from: "2026-07-25",
        to: "2026-08-23",
        dataSnapshotId: "snapshot-old",
        projectReleaseId: "release-old",
        finding: "old-finding",
        evidence: "old-evidence",
      }),
    )).toBe(
      "/energyiq/ai?projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
  });

  it("does not navigate when a task already uses the semantic all-available entry", () => {
    expect(freshEnergyAnalysisTaskHref(
      "/energyiq/ai",
      new URLSearchParams("projectId=tuya-office&scopeId=project&resource=electricity"),
    )).toBeNull();
  });
});

describe("decideEnergySessionContextRestore", () => {
  it("does not replace a direct semantic all-available entry with an initially restored historical Session", () => {
    const decision = decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity",
      ),
      context: historical,
      initialRestoredContextKey: null,
    });

    expect(decision.href).toBeNull();
    expect(decision.initialRestoredContextKey).toBe(false);
  });

  it("preserves an explicit requested window on the initial conversation restore", () => {
    const decision = decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16",
      ),
      context: historical,
      initialRestoredContextKey: null,
    });

    expect(decision.href).toBeNull();
    expect(decision.initialRestoredContextKey).toBeTruthy();
  });

  it("still restores a different historical context after the initial session", () => {
    const initial = decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16",
      ),
      context: historical,
      initialRestoredContextKey: null,
    });
    const other = {
      ...historical,
      from: "2026-07-01T16:00:00.000Z",
      to: "2026-07-08T16:00:00.000Z",
      dataSnapshotId: "snapshot-b",
    };

    const href = decideEnergySessionContextRestore({
      pathname: "/energyiq/ai",
      currentSearchParams: new URLSearchParams(
        "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity&period=Custom&from=2026-05-20&to=2026-06-16",
      ),
      context: other,
      initialRestoredContextKey: initial.initialRestoredContextKey,
    }).href;
    const restored = new URL(href!, "https://energyiq.local").searchParams;
    expect(restored.get("from")).toBe(other.from);
    expect(restored.get("to")).toBe(other.to);
    expect(restored.get("dataSnapshotId")).toBe("snapshot-b");
  });
});

describe("energySessionContextStatus", () => {
  it("marks historical answers outdated when the authorized Snapshot changed", () => {
    expect(energySessionContextStatus(historical, resolved("snapshot-b"))).toEqual({
      status: "outdated",
      reason: "This answer used an older data Snapshot. Its figures are preserved, but current data has changed.",
    });
  });

  it("keeps historical answers current when the restored authorized context is identical", () => {
    expect(energySessionContextStatus(historical, resolved("snapshot-a"))).toEqual({
      status: "current",
    });
  });

  it("marks a same-Snapshot Session outdated when its publication revisions drift", () => {
    expect(energySessionContextStatus(historical, {
      ...resolved("snapshot-a"),
      meterFormulaRevisionId: "formula-2",
    })).toEqual({
      status: "outdated",
      reason: "This answer used an older version of the facility details. Its figures remain read-only.",
    });
  });

  it("marks a same-Snapshot Session outdated when a Project Release appears", () => {
    expect(energySessionContextStatus({ ...historical, projectReleaseId: undefined }, {
      ...resolved("snapshot-a"),
      projectReleaseId: "release-1",
    })).toEqual({
      status: "outdated",
      reason: "This answer used an older version of the facility details. Its figures remain read-only.",
    });
  });
});

function resolved(dataSnapshotId: string): EnergyQueryContextDto {
  return {
    userId: "user-1",
    workspaceId: historical.workspaceId,
    projectId: historical.projectId,
    projectName: historical.projectName,
    scopeId: historical.scopeId,
    scopeName: historical.scopeName,
    scopeType: historical.scopeType,
    resource: historical.resource,
    timezone: historical.timezone,
    from: historical.from,
    to: historical.to,
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy-1",
    meterMappingRevisionId: "mapping-1",
    meterFormulaRevisionId: "formula-1",
    dataSnapshotId,
    metricVersion: "metric-1",
    businessCalendarVersion: "calendar-1",
    tariffScheduleVersion: "tariff-1",
    projectReleaseId: "release-1",
    resolvedAt: "2026-08-07T00:00:00.000Z",
  };
}
