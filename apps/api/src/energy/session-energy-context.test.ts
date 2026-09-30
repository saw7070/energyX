import { describe, expect, it } from "vitest";

import type { ContextPackageSnapshotRecord } from "@datafoundry/metadata";

import {
  inspectLatestAuthoritativeEnergyContextSnapshots,
  inspectSessionEnergyContextSnapshot,
  sessionEnergyContextFromPersistedJson,
  sessionEnergyContextFromSnapshot,
  validateEnergySessionForkLineage,
} from "./session-energy-context.js";

describe("inspectSessionEnergyContextSnapshot", () => {
  it("keeps a generic package absent and a malformed server Energy item invalid", () => {
    expect(inspectSessionEnergyContextSnapshot(snapshot({
      sourceType: "knowledge",
      trust: "tool",
      metadata: {},
      content: "Generic context",
    }))).toEqual({ status: "absent" });
    expect(inspectSessionEnergyContextSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "browser",
        energyQueryContext: structuredEnergyContext(),
      },
      content: "Untrusted context",
    }))).toEqual({ status: "invalid" });
  });

  it("skips a later generic package and restores the latest authoritative Energy binding", () => {
    const authoritative = snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: structuredEnergyContext(),
      },
      content: "Authoritative Energy context",
    });
    const generic = {
      ...snapshot({
        sourceType: "knowledge",
        trust: "tool",
        metadata: {},
        content: "Later generic context",
      }),
      id: "context-snapshot-2",
      package_id: "package-2",
      revision: 2,
      created_at: "2026-08-07T01:00:00.000Z",
    };

    expect(inspectLatestAuthoritativeEnergyContextSnapshots([
      generic,
      authoritative,
    ])).toMatchObject({
      status: "available",
      context: {
        sourceRunId: "run-1",
        dataSnapshotId: "snapshot-p",
      },
    });
  });

  it("streams past more than the legacy 500-snapshot list cap", () => {
    function* snapshots(): IterableIterator<ContextPackageSnapshotRecord> {
      for (let revision = 600; revision > 0; revision -= 1) {
        yield {
          ...snapshot({ sourceType: "generic", content: "unrelated" }),
          id: `generic-${revision}`,
          revision,
        };
      }
      yield snapshot({
        sourceType: "energy-query-context",
        trust: "tool",
        metadata: {
          sourceKind: "energy-query-context",
          sourceOwner: "server",
          energyQueryContext: structuredEnergyContext(),
        },
        content: "authoritative context",
      });
    }

    expect(inspectLatestAuthoritativeEnergyContextSnapshots(snapshots()))
      .toMatchObject({ status: "available", context: { projectId: "preschool-demo" } });
  });
});

describe("sessionEnergyContextFromSnapshot", () => {
  it("restores the server-authored EnergyIQ context from a historical package", () => {
    const context = sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "evidence-focus",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        originalSourceType: "energy-query-context",
      },
      content: [
        "Authoritative EnergyIQ query context.",
        "workspace_id=workspace-ngee-ann",
        "project_id=ngee-ann-polytechnic",
        "project_name=Ngee Ann Polytechnic",
        "scope_id=project",
        "scope_name=Ngee Ann Polytechnic",
        "scope_type=project",
        "resource=electricity",
        "timezone=Asia/Singapore",
        "from=2026-06-02T16:00:00.000Z",
        "to_exclusive=2026-06-09T16:00:00.000Z",
        "hierarchy_revision_id=hierarchy-v1",
        "meter_mapping_revision_id=mapping-v1",
        "meter_formula_revision_id=formula-v1",
        "project_release_id=release-v1",
        "data_snapshot_id=snapshot-a",
      ].join("\n"),
    }));

    expect(context).toEqual({
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
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      projectReleaseId: "release-v1",
      dataSnapshotId: "snapshot-a",
    });
  });

  it("prefers structured metadata for newly recorded packages", () => {
    const context = sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: {
          workspaceId: "workspace-preschool",
          projectId: "preschool-demo",
          projectName: "Preschool Demo",
          scopeId: "preschool-project",
          scopeName: "All centres",
          scopeType: "project",
          resource: "electricity",
          timezone: "Asia/Singapore",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
          hierarchyRevisionId: "hierarchy-v4",
          meterMappingRevisionId: "mapping-v2",
          meterFormulaRevisionId: "formula-v2",
          projectReleaseId: "release-v4",
          dataSnapshotId: "snapshot-p",
        },
      },
      content: "legacy content is not required",
    }));

    expect(context).toMatchObject({
      sourceRunId: "run-1",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-p",
      hierarchyRevisionId: "hierarchy-v4",
      meterMappingRevisionId: "mapping-v2",
      meterFormulaRevisionId: "formula-v2",
      projectReleaseId: "release-v4",
    });
  });

  it("restores complete current-data fork lineage for range disclosure", () => {
    const context = sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: {
          ...structuredEnergyContext(),
          forkedFromSessionId: "session-historical",
          forkedFromRunId: "run-historical",
          forkedFromFrom: "2026-05-31T16:00:00.000Z",
          forkedFromTo: "2026-06-30T16:00:00.000Z",
        },
      },
      content: "authoritative forked context",
    }));

    expect(context).toMatchObject({
      forkedFromSessionId: "session-historical",
      forkedFromRunId: "run-historical",
      forkedFromFrom: "2026-05-31T16:00:00.000Z",
      forkedFromTo: "2026-06-30T16:00:00.000Z",
    });
  });

  it("rejects partial current-data fork lineage", () => {
    expect(sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: {
          ...structuredEnergyContext(),
          forkedFromSessionId: "session-historical",
        },
      },
      content: "partial fork lineage",
    }))).toBeUndefined();
  });

  it("rejects a historical package that lacks the publication revision identity", () => {
    expect(sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: {
          workspaceId: "workspace-preschool",
          projectId: "preschool-demo",
          projectName: "Preschool Demo",
          scopeId: "preschool-project",
          scopeName: "All centres",
          scopeType: "project",
          resource: "electricity",
          timezone: "Asia/Singapore",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
          dataSnapshotId: "snapshot-p",
        },
      },
      content: "legacy context without revisions",
    }))).toBeUndefined();
  });

  it("accepts an authoritative historical context when Project Release is genuinely absent", () => {
    expect(sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
        energyQueryContext: structuredEnergyContext(),
      },
      content: "authoritative context without a Project Release",
    }))).toMatchObject({
      projectId: "preschool-demo",
      dataSnapshotId: "snapshot-p",
    });
  });

  it.each(["", 42])(
    "rejects a structured historical context with present-invalid Project Release %j",
    (projectReleaseId) => {
      expect(sessionEnergyContextFromSnapshot(snapshot({
        sourceType: "energy-query-context",
        trust: "tool",
        metadata: {
          sourceKind: "energy-query-context",
          sourceOwner: "server",
          energyQueryContext: {
            ...structuredEnergyContext(),
            projectReleaseId,
          },
        },
        content: "invalid structured release identity",
      }))).toBeUndefined();
    },
  );

  it("rejects a text historical context with a present-empty Project Release", () => {
    expect(sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "tool",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "server",
      },
      content: [
        "workspace_id=workspace-preschool",
        "project_id=preschool-demo",
        "project_name=Preschool Demo",
        "scope_id=preschool-project",
        "scope_name=All centres",
        "scope_type=project",
        "resource=electricity",
        "timezone=Asia/Singapore",
        "from=2026-04-30T16:00:00.000Z",
        "to_exclusive=2026-05-31T16:00:00.000Z",
        "hierarchy_revision_id=hierarchy-v4",
        "meter_mapping_revision_id=mapping-v2",
        "meter_formula_revision_id=formula-v2",
        "project_release_id=",
        "data_snapshot_id=snapshot-p",
      ].join("\n"),
    }))).toBeUndefined();
  });

  it("does not restore client-authored or untrusted context", () => {
    expect(sessionEnergyContextFromSnapshot(snapshot({
      sourceType: "energy-query-context",
      trust: "untrusted-client",
      metadata: {
        sourceKind: "energy-query-context",
        sourceOwner: "client",
      },
      content: "project_id=ngee-ann-polytechnic",
    }))).toBeUndefined();
  });
});

describe("sessionEnergyContextFromPersistedJson", () => {
  it("restores an exact pre-Run Session context without inventing a Run identity", () => {
    expect(sessionEnergyContextFromPersistedJson(JSON.stringify({
      ...structuredEnergyContext(),
      forkedFromSessionId: "session-historical",
      forkedFromContextStatus: "available",
      forkedFromRunId: "run-historical",
      forkedFromFrom: "2026-03-31T16:00:00.000Z",
      forkedFromTo: "2026-04-30T16:00:00.000Z",
    }))).toEqual({
      ...structuredEnergyContext(),
      forkedFromSessionId: "session-historical",
      forkedFromContextStatus: "available",
      forkedFromRunId: "run-historical",
      forkedFromFrom: "2026-03-31T16:00:00.000Z",
      forkedFromTo: "2026-04-30T16:00:00.000Z",
    });
  });

  it("rejects malformed or partial pre-Run context", () => {
    expect(sessionEnergyContextFromPersistedJson("not-json")).toBeUndefined();
    expect(sessionEnergyContextFromPersistedJson(JSON.stringify({
      ...structuredEnergyContext(),
      forkedFromSessionId: "session-historical",
    }))).toBeUndefined();
    expect(sessionEnergyContextFromPersistedJson(JSON.stringify({
      ...structuredEnergyContext(),
      forkedFromSessionId: 42,
    }))).toBeUndefined();
  });

  it("restores honest unavailable continuation lineage without inventing a source Run", () => {
    expect(sessionEnergyContextFromPersistedJson(JSON.stringify({
      ...structuredEnergyContext(),
      forkedFromSessionId: "session-contextless",
      forkedFromContextStatus: "unavailable",
      forkedFromUnavailableReason: "source-run-unavailable",
    }))).toEqual({
      ...structuredEnergyContext(),
      forkedFromSessionId: "session-contextless",
      forkedFromContextStatus: "unavailable",
      forkedFromUnavailableReason: "source-run-unavailable",
    });
  });

  it("rejects required exact identity that exists only on Object.prototype", () => {
    const { workspaceId: _workspaceId, ...withoutWorkspace } = structuredEnergyContext();
    Object.defineProperty(Object.prototype, "workspaceId", {
      configurable: true,
      value: "workspace-inherited",
    });
    try {
      expect(sessionEnergyContextFromPersistedJson(JSON.stringify(withoutWorkspace)))
        .toBeUndefined();
    } finally {
      delete (Object.prototype as { workspaceId?: string }).workspaceId;
    }
  });
});

describe("validateEnergySessionForkLineage", () => {
  const lineage = {
    sourceSessionId: "session-historical",
    sourceRunId: "run-historical",
    sourceFrom: "2026-05-31T16:00:00.000Z",
    sourceTo: "2026-06-30T16:00:00.000Z",
  };

  it("accepts only an actor-owned source Session in the same Workspace and Project", () => {
    expect(validateEnergySessionForkLineage({
      currentSessionId: "session-current",
      currentWorkspaceId: "workspace-preschool",
      currentProjectId: "preschool-demo",
      lineage,
      readSourceSession: () => ({
        workspaceId: "workspace-preschool",
        projectId: "preschool-demo",
      }),
      readSourceRunContext: () => ({
        sessionId: "session-historical",
        workspaceId: "workspace-preschool",
        projectId: "preschool-demo",
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
      }),
    })).toEqual({
      ...lineage,
      sourceFrom: "2026-04-30T16:00:00.000Z",
      sourceTo: "2026-05-31T16:00:00.000Z",
    });
  });

  it.each([
    ["self", "session-historical", "workspace-preschool", "preschool-demo", "SELF_REFERENCE"],
    ["Workspace", "session-current", "workspace-other", "preschool-demo", "WORKSPACE_MISMATCH"],
    ["Project", "session-current", "workspace-preschool", "tuya-office", "PROJECT_MISMATCH"],
  ])("rejects %s lineage", (_case, currentSessionId, sourceWorkspaceId, sourceProjectId, error) => {
    expect(() => validateEnergySessionForkLineage({
      currentSessionId,
      currentWorkspaceId: "workspace-preschool",
      currentProjectId: "preschool-demo",
      lineage,
      readSourceSession: () => ({
        workspaceId: sourceWorkspaceId,
        projectId: sourceProjectId,
      }),
      readSourceRunContext: () => ({
        sessionId: "session-historical",
        workspaceId: "workspace-preschool",
        projectId: "preschool-demo",
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
      }),
    })).toThrow(`ENERGYIQ_SESSION_FORK_${error}`);
  });

  it.each([
    [
      "RUN_MISMATCH",
      { sessionId: "session-other", workspaceId: "workspace-preschool", projectId: "preschool-demo", from: lineage.sourceFrom, to: lineage.sourceTo },
    ],
    [
      "SOURCE_CONTEXT_MISMATCH",
      { sessionId: lineage.sourceSessionId, workspaceId: "workspace-preschool", projectId: "tuya-office", from: lineage.sourceFrom, to: lineage.sourceTo },
    ],
    [
      "SOURCE_CONTEXT_UNAVAILABLE",
      { sessionId: lineage.sourceSessionId, workspaceId: "workspace-preschool", projectId: "preschool-demo", from: undefined, to: undefined },
    ],
  ])("rejects server source evidence with %s", (error, sourceRunContext) => {
    expect(() => validateEnergySessionForkLineage({
      currentSessionId: "session-current",
      currentWorkspaceId: "workspace-preschool",
      currentProjectId: "preschool-demo",
      lineage,
      readSourceSession: () => ({
        workspaceId: "workspace-preschool",
        projectId: "preschool-demo",
      }),
      readSourceRunContext: () => sourceRunContext,
    })).toThrow(`ENERGYIQ_SESSION_FORK_${error}`);
  });
});

function structuredEnergyContext(): Record<string, unknown> {
  return {
    workspaceId: "workspace-preschool",
    projectId: "preschool-demo",
    projectName: "Preschool Demo",
    scopeId: "preschool-project",
    scopeName: "All centres",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: "2026-04-30T16:00:00.000Z",
    to: "2026-05-31T16:00:00.000Z",
    hierarchyRevisionId: "hierarchy-v4",
    meterMappingRevisionId: "mapping-v2",
    meterFormulaRevisionId: "formula-v2",
    dataSnapshotId: "snapshot-p",
  };
}

function snapshot(item: Record<string, unknown>): ContextPackageSnapshotRecord {
  return {
    id: "context-snapshot-1",
    user_id: "user-1",
    session_id: "session-1",
    run_id: "run-1",
    package_id: "package-1",
    revision: 1,
    payload_json: JSON.stringify({ items: [item] }),
    created_at: "2026-08-07T00:00:00.000Z",
  };
}
