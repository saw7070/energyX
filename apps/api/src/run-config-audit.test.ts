import { describe, expect, it } from "vitest";

import {
  createRunConfigAuditCapture,
  createSkillLoadedAuditCaptures,
  createSkillMaterializedAuditCapture,
} from "./run-config-audit.js";

describe("Run config audit capture", () => {
  it("persists exact resource revisions and MCP server-to-tool mapping with stable ordering", () => {
    expect(createRunConfigAuditCapture({
      resourceRevisions: {
        "skill:investigation": 4,
        "model-profile:system": 7,
      },
      mcpToolNamesByServerId: {
        "server-z": ["forecast_read", "forecast_read"],
        "server-a": ["asset_lookup"],
      },
    })).toEqual({
      resource_revisions: {
        "model-profile:system": 7,
        "skill:investigation": 4,
      },
      mcp_tool_names_by_server_id: {
        "server-a": ["asset_lookup"],
        "server-z": ["forecast_read"],
      },
    });
  });

  it("records only exact Skill identity materialized into the started Run", () => {
    expect(createSkillMaterializedAuditCapture([
      {
        configRevision: 3,
        contentSha256: `sha256:${"b".repeat(64)}`,
        id: "skill-z",
        name: "Skill Z",
        packageRef: "file-ref-z",
        path: "skills/skill-z",
      },
      {
        configRevision: 5,
        contentSha256: `sha256:${"a".repeat(64)}`,
        id: "skill-a",
        name: "Skill A",
        packageRef: "file-ref-a",
        path: "skills/skill-a",
      },
    ])).toEqual({
      items: [
        {
          content_sha256: `sha256:${"a".repeat(64)}`,
          id: "skill-a",
          package_ref: "file-ref-a",
          revision: 5,
        },
        {
          content_sha256: `sha256:${"b".repeat(64)}`,
          id: "skill-z",
          package_ref: "file-ref-z",
          revision: 3,
        },
      ],
    });
  });

  it("creates deterministic secret-free load evidence only from actual reader output", () => {
    const captures = createSkillLoadedAuditCaptures("run-1", [{
      configRevision: 7,
      contentSha256: `sha256:${"a".repeat(64)}`,
      id: "data-analysis",
      instructions: "private model-visible Skill instructions",
      loadSource: "materialized-skill-package",
      loadStage: "agent-instruction-assembly",
      name: "Data Analysis",
      owner: { scope: "workspace", userId: "analyst-1", workspaceId: "workspace-1" },
      packageRef: "file-ref-data-analysis-v1",
      semanticVersion: "1.0.0",
    }]);

    expect(captures).toEqual([expect.objectContaining({
      eventId: expect.stringMatching(/^skill-loaded:run-1:data-analysis:7:[a-f0-9]{64}$/u),
      run_event_schema_version: 1,
      skill: expect.objectContaining({
        config_revision: 7,
        content_sha256: `sha256:${"a".repeat(64)}`,
        id: "data-analysis",
        package_ref: "file-ref-data-analysis-v1",
      }),
    })]);
    expect(JSON.stringify(captures)).not.toContain("private model-visible Skill instructions");
    expect(createSkillLoadedAuditCaptures("run-1", captures.length > 0 ? [{
      configRevision: 7,
      contentSha256: `sha256:${"a".repeat(64)}`,
      id: "data-analysis",
      instructions: "different prose does not alter identity after the reader verified the same hash",
      loadSource: "materialized-skill-package",
      loadStage: "agent-instruction-assembly",
      name: "Data Analysis",
      owner: { scope: "workspace", userId: "analyst-1", workspaceId: "workspace-1" },
      packageRef: "file-ref-data-analysis-v1",
      semanticVersion: "1.0.0",
    }] : [])[0]?.eventId).toBe(captures[0]?.eventId);
  });
});
