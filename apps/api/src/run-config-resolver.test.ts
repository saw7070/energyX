import type { RunAgentInput } from "@ag-ui/client";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveRunConfig } from "./run-config-resolver.js";

describe("resolveRunConfig implicit Skill boundary", () => {
  const roots: string[] = [];

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it("does not load an Overview-only Skill that an ordinary run did not explicitly mention", () => {
    const { metadata, root } = createHarness();
    roots.push(root);

    const resolved = resolveRunConfig({
      implicitSkillDenylist: ["energy-insight-investigation"],
      metadataStore: metadata,
      runInput: runInput(),
      userId: "dev-user",
      userInput: "List the three Centres that deserve priority review",
      workspaceId: "default",
    });
    metadata.close();

    expect(resolved.effectiveRunConfig.activeSkillId).toBeUndefined();
    expect(resolved.effectiveRunConfig.enabledSkillIds).toEqual(["general-analysis"]);
    expect(resolved.selectedSkills.map((skill) => skill.id)).toEqual(["general-analysis"]);
    expect(resolved.effectiveRunConfig.resourceRevisions)
      .not.toHaveProperty("skill:energy-insight-investigation");
  });

  it("preserves an explicit per-run Skill mention", () => {
    const { metadata, root } = createHarness();
    roots.push(root);

    const input = runInput();
    (input.forwardedProps as { run_config: Record<string, unknown> }).run_config.mentioned = {
      db: [], kb: [], mcp: [], skill: ["energy-insight-investigation"],
    };
    const resolved = resolveRunConfig({
      implicitSkillDenylist: ["energy-insight-investigation"],
      metadataStore: metadata,
      runInput: input,
      userId: "dev-user",
      userInput: "Use the investigation method",
      workspaceId: "default",
    });
    metadata.close();

    expect(resolved.effectiveRunConfig.activeSkillId).toBe("energy-insight-investigation");
    expect(resolved.selectedSkills.map((skill) => skill.id))
      .toContain("energy-insight-investigation");
  });

  it("preserves an explicit no-Skill choice after removing a leaked passive default", () => {
    const { metadata, root } = createHarness();
    roots.push(root);

    const input = runInput();
    (input.forwardedProps as { run_config: Record<string, unknown> }).run_config.skillMode = "none";
    const resolved = resolveRunConfig({
      implicitSkillDenylist: ["energy-insight-investigation"],
      metadataStore: metadata,
      runInput: input,
      userId: "dev-user",
      userInput: "Answer without a Skill",
      workspaceId: "default",
    });
    metadata.close();

    expect(resolved.effectiveRunConfig.skillMode).toBe("none");
    expect(resolved.effectiveRunConfig.activeSkillId).toBeUndefined();
    expect(resolved.effectiveRunConfig.enabledSkillIds).toEqual(["general-analysis"]);
    expect(resolved.selectedSkills).toEqual([]);
  });

  it("preserves a server-owned workflow Skill when no implicit boundary is requested", () => {
    const { metadata, root } = createHarness();
    roots.push(root);

    const resolved = resolveRunConfig({
      metadataStore: metadata,
      runInput: runInput(),
      userId: "dev-user",
      userInput: "Run the published Overview investigation workflow",
      workspaceId: "default",
    });
    metadata.close();

    expect(resolved.effectiveRunConfig.activeSkillId).toBe("energy-insight-investigation");
    expect(resolved.selectedSkills.map((skill) => skill.id))
      .toContain("energy-insight-investigation");
  });

  it("fails closed before Runtime assembly when an explicitly requested data-analysis revision is stale", () => {
    const { metadata, root } = createHarness();
    roots.push(root);
    metadata.configResources.upsert({
      id: "data-analysis",
      workspace_id: "default",
      user_id: "dev-user",
      kind: "skill",
      name: "data-analysis",
      description: "Stale governed analysis",
      payload: {
        packageFileRefId: "data-analysis-package-ref",
        userInvocable: true,
        version: "1.0.0",
      },
      default_enabled: true,
      status: "stale",
    });
    const input = runInput();
    (input.forwardedProps as { run_config: Record<string, unknown> }).run_config = {
      activeSkillId: "data-analysis",
      enabledSkillIds: ["data-analysis"],
      mentioned: { db: [], kb: [], mcp: [], skill: ["data-analysis"] },
      skillIds: ["data-analysis"],
      skillMode: "selected",
    };

    expect(() => resolveRunConfig({
      metadataStore: metadata,
      runInput: input,
      userId: "dev-user",
      userInput: "Analyze with the governed Skill",
      workspaceId: "default",
    })).toThrow("CONFIG_RESOURCE_NOT_ENABLED:skill:data-analysis");
    metadata.close();
  });
});

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "run-config-skill-boundary-"));
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    secret_master_key: "test-key",
  });
  metadata.users.upsertDevUser({
    id: "dev-user",
    email: "dev@example.test",
    display_name: "Developer",
    dev_token: "dev-token",
  });
  metadata.workspaces.upsert({
    id: "default",
    owner_user_id: "dev-user",
    name: "EnergyIQ",
    kind: "personal",
  });
  const secretRef = metadata.secrets.put({
    workspace_id: "default",
    user_id: "dev-user",
    owner_kind: "model-profile",
    owner_id: "model-default",
    value: { apiKey: "test-secret" },
  });
  metadata.configResources.upsert({
    id: "model-default",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Model",
    payload: {
      provider: "openai-compatible",
      modelName: "test-model",
      baseUrl: "https://model.example.test/v1",
    },
    secret_ref: secretRef,
    default_enabled: true,
    status: "connected",
  });
  metadata.configResources.upsert({
    id: "energy-insight-investigation",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "skill",
    name: "energy-insight-investigation",
    description: "Find incremental EnergyIQ Overview insights",
    payload: {
      packageFileRefId: "skill-package-ref",
      userInvocable: true,
      version: "1.0.0",
    },
    default_enabled: true,
    status: "valid",
  });
  metadata.configResources.upsert({
    id: "general-analysis",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "skill",
    name: "general-analysis",
    description: "General evidence-led analysis",
    payload: {
      packageFileRefId: "general-skill-package-ref",
      userInvocable: true,
      version: "1.0.0",
    },
    default_enabled: true,
    status: "valid",
  });
  return { metadata, root };
}

function runInput(): RunAgentInput {
  return {
    context: [],
    forwardedProps: {
      run_config: {
        activeSkillId: "energy-insight-investigation",
        enabledSkillIds: ["energy-insight-investigation", "general-analysis"],
      },
    },
    messages: [],
    runId: "run-1",
    state: {},
    threadId: "thread-1",
    tools: [],
  };
}
