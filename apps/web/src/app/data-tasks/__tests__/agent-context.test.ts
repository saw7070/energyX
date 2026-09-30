import { describe, expect, it } from "vitest";
import {
  summarizeWorkspaceConfigForAgentContext,
  type WorkspaceConfigStore,
} from "../data-task-state";

describe("summarizeWorkspaceConfigForAgentContext", () => {
  it("keeps RUN_STARTED context bounded when a workspace has hundreds of datasources", () => {
    const workspaceConfig: WorkspaceConfigStore = {
      db: Array.from({ length: 306 }, (_, index) => ({
        id: `datasource-${index}`,
        name: `Datasource ${index}`,
        description: "A deliberately verbose datasource definition".repeat(20),
        enabled: true,
        status: index % 2 === 0 ? "connected" : "untested",
        settings: {
          schema: "x".repeat(512),
          table: `table_${index}`,
        },
      })),
      kb: [],
      mcp: [],
      llm: [
        {
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          description: "Current model",
          enabled: true,
          status: "connected",
        },
      ],
      skill: [
        {
          id: "energy-analysis",
          name: "Energy analysis",
          description: "Current skill",
          enabled: true,
          status: "connected",
        },
      ],
    };

    const summary = summarizeWorkspaceConfigForAgentContext(workspaceConfig);

    expect(summary).toEqual({
      db: { configured: 306, enabled: 306, connected: 153 },
      kb: { configured: 0, enabled: 0, connected: 0 },
      mcp: { configured: 0, enabled: 0, connected: 0 },
      llm: { configured: 1, enabled: 1, connected: 1 },
      skill: { configured: 1, enabled: 1, connected: 1 },
    });
    expect(JSON.stringify(summary).length).toBeLessThan(512);
    expect(JSON.stringify(summary)).not.toContain("datasource-305");
    expect(JSON.stringify(summary)).not.toContain("schema");
  });
});
