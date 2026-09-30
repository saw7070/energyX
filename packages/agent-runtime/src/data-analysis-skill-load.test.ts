import type { FileAssetService } from "@datafoundry/files";
import type { SkillRecord, SkillSelectionResult } from "@datafoundry/skills";
import { createTool } from "@mastra/core/tools";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createDataFoundry, type CreateDataFoundryInput } from "./index.js";

const roots: string[] = [];
const SKILL_CONTENT = Buffer.from([
  "---",
  "name: data-analysis",
  "description: Governed analysis.",
  "version: 1.0.0",
  "allowed-tools:",
  "  - inspect_schema",
  "---",
  "# Data Analysis",
  "Inspect before querying.",
  "",
].join("\n"), "utf8");
const UNRELATED_SKILL_CONTENT = Buffer.from([
  "---",
  "name: other-selected-skill",
  "description: A separately governed selected Skill.",
  "version: 1.0.0",
  "---",
  "# Other Selected Skill",
  "This content must not be loaded into the model request.",
  "",
].join("\n"), "utf8");

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true }));
});

describe("data-analysis governed Runtime loading", () => {
  it("assembles only actually read Skill content and exact identity into model-visible instructions", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "data-analysis-runtime-load-"));
    roots.push(workspaceRoot);
    const selectedSkill = dataAnalysisSkill();
    const unrelatedSelectedSkill: SkillRecord = {
      ...dataAnalysisSkill(),
      builtin: false,
      id: "other-selected-skill",
      name: "other-selected-skill",
      owner: { scope: "workspace", userId: "analyst-1", workspaceId: "workspace-1" },
      packageFileRefId: "file-ref-other-selected-skill-v1",
      scope: "workspace",
    };
    const runtime = await createDataFoundry({
      analysisRequirementsMode: "omit",
      dataGateway: {} as never,
      disableTools: true,
      emitter: { emit: () => undefined },
      fileAssetService: fileAssets(),
      explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
      messages: [],
      modelProvider: modelProvider(),
      runContext: runContext("load"),
      selectedSkills: [selectedSkill, unrelatedSelectedSkill],
      skillSelection: {
        ...selection(selectedSkill, ["inspect_schema"]),
        selectedSkills: [selectedSkill, unrelatedSelectedSkill],
      },
      workspaceRoot,
    });

    try {
      expect(runtime.materializedSkills).toEqual([
        expect.objectContaining({
          id: "data-analysis",
          packageRef: "file-ref-data-analysis-v1",
        }),
        expect.objectContaining({
          id: "other-selected-skill",
          packageRef: "file-ref-other-selected-skill-v1",
        }),
      ]);
      expect(runtime.loadedSkills).toEqual([expect.objectContaining({
        configRevision: 7,
        contentSha256: "sha256:ab4da52116de4d1dba246ed552ba0c93eab07e9e68ef39d6ad0e9adfc6222b5a",
        id: "data-analysis",
        instructions: "# Data Analysis\nInspect before querying.",
        packageRef: "file-ref-data-analysis-v1",
        semanticVersion: "1.0.0",
      })]);
      const instructions = await runtime.agent.getInstructions();
      const text = typeof instructions === "string" ? instructions : JSON.stringify(instructions);
      expect(text).toContain("Loaded governed Skill instructions:");
      expect(text).toContain("# Data Analysis\nInspect before querying.");
      expect(text).not.toContain("# Other Selected Skill");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it("does not let loaded Skill prose widen an empty server Tool policy", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "data-analysis-runtime-policy-"));
    roots.push(workspaceRoot);
    const selectedSkill = dataAnalysisSkill();
    selectedSkill.allowedTools = [];
    const runtime = await createDataFoundry({
      analysisRequirementsMode: "omit",
      dataGateway: {} as never,
      emitter: { emit: () => undefined },
      excludedToolNames: ["skill", "skill_search", "skill_read"],
      fileAssetService: fileAssets(),
      explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
      messages: [],
      modelProvider: modelProvider(),
      runContext: {
        ...runContext("policy"),
        enabled_datasource_ids: ["datasource-1"],
        selected_datasource_id: "datasource-1",
      },
      selectedSkills: [selectedSkill],
      skillSelection: selection(selectedSkill, []),
      workspaceRoot,
    });

    try {
      expect(await runtime.agent.listTools()).not.toHaveProperty("inspect_schema");
      expect(await runtime.agent.listTools()).not.toHaveProperty("run_sql_readonly");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it.each([
    { allowedTools: [], label: "empty" },
    { allowedTools: ["inspect_schema"], label: "disjoint" },
  ])("does not let MCP candidates bypass an $label Skill policy intersection", async ({ allowedTools }) => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "data-analysis-mcp-policy-"));
    roots.push(workspaceRoot);
    const mcpTools = {
      "mcp.workspace.lookup": createTool({
        id: "mcp.workspace.lookup",
        description: "Synthetic MCP lookup tool.",
        inputSchema: z.object({}).strict(),
        execute: async () => ({ ok: true }),
      }),
    } as unknown as NonNullable<CreateDataFoundryInput["mcpTools"]>;
    const runtime = await createDataFoundry({
      analysisRequirementsMode: "omit",
      dataGateway: {} as never,
      emitter: { emit: () => undefined },
      explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
      mcpToolNames: ["mcp.workspace.lookup"],
      mcpTools,
      messages: [],
      modelProvider: modelProvider(),
      runContext: runContext(`mcp-${allowedTools.join("-") || "empty"}`),
      skillSelection: {
        audit: [],
        effectiveToolPolicy: { allowedTools, deniedTools: [], mergeStrategy: "intersection" },
        selectedSkills: [],
      },
      workspaceRoot,
    });

    try {
      expect(await runtime.agent.listTools()).not.toHaveProperty("mcp.workspace.lookup");
    } finally {
      await runtime.destroyWorkspace();
    }
  });

  it("keeps the exact MCP capability when it is inside the server and Skill intersection", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "data-analysis-mcp-exact-policy-"));
    roots.push(workspaceRoot);
    const mcpTools = {
      "mcp.workspace.lookup": createTool({
        id: "mcp.workspace.lookup",
        description: "Synthetic MCP lookup tool.",
        inputSchema: z.object({}).strict(),
        execute: async () => ({ ok: true }),
      }),
    } as unknown as NonNullable<CreateDataFoundryInput["mcpTools"]>;
    const runtime = await createDataFoundry({
      analysisRequirementsMode: "omit",
      dataGateway: {} as never,
      emitter: { emit: () => undefined },
      explicitProtocol: { protocolId: "data-analysis", protocolVersion: "1" },
      mcpToolNames: ["mcp.workspace.lookup"],
      mcpTools,
      messages: [],
      modelProvider: modelProvider(),
      runContext: runContext("mcp-exact"),
      skillSelection: {
        audit: [],
        effectiveToolPolicy: {
          allowedTools: ["mcp.workspace.lookup"],
          deniedTools: [],
          mergeStrategy: "intersection",
        },
        selectedSkills: [],
      },
      workspaceRoot,
    });

    try {
      expect(await runtime.agent.listTools()).toHaveProperty("mcp.workspace.lookup");
    } finally {
      await runtime.destroyWorkspace();
    }
  });
});

const selection = (skill: SkillRecord, allowedTools: string[]): SkillSelectionResult => ({
  audit: [{ decision: "selected", reasons: ["explicit:id"], skillId: skill.id }],
  effectiveToolPolicy: { allowedTools, deniedTools: [], mergeStrategy: "intersection" },
  selectedSkills: [skill],
});

const dataAnalysisSkill = (): SkillRecord => ({
  allowedTools: ["inspect_schema"],
  builtin: true,
  defaultDbIds: [],
  defaultEnabled: true,
  defaultKbIds: [],
  defaultMcpIds: [],
  deniedTools: [],
  description: "Governed analysis.",
  id: "data-analysis",
  name: "data-analysis",
  owner: { scope: "builtin", userId: "analyst-1", workspaceId: "workspace-1" },
  packageEntry: "SKILL.md",
  packageFileRefId: "file-ref-data-analysis-v1",
  packageFiles: ["SKILL.md"],
  packageFormat: "skill-md",
  revision: 7,
  scope: "builtin",
  status: "valid",
  tags: ["data"],
  userInvocable: true,
  version: "1.0.0",
});

const fileAssets = (): FileAssetService => ({
  readRef: ({ id, user_id, workspace_id }) => {
    if (user_id !== "analyst-1" || workspace_id !== "workspace-1") {
      throw new Error("FILE_ASSET_REF_NOT_FOUND");
    }
    if (id === "file-ref-data-analysis-v1") {
      return { body: SKILL_CONTENT, mimeType: "text/markdown" };
    }
    if (id === "file-ref-other-selected-skill-v1") {
      return { body: UNRELATED_SKILL_CONTENT, mimeType: "text/markdown" };
    }
    throw new Error("FILE_ASSET_REF_NOT_FOUND");
  },
} as FileAssetService);

const modelProvider = (): CreateDataFoundryInput["modelProvider"] => ({
  kind: "openai-compatible",
  model: "openai/test-model",
  model_name: "test-model",
  provider_id: "openai-compatible",
});

const runContext = (suffix: string): CreateDataFoundryInput["runContext"] => ({
  user_id: "analyst-1",
  workspace_id: "workspace-1",
  session_id: `session-${suffix}`,
  run_id: `run-${suffix}`,
  user_input: "Analyze the governed dataset.",
  chat_mode: "copilotkit",
  model_name: "test-model",
});
