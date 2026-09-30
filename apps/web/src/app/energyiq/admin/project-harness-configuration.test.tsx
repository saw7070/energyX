/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectHarnessConfigurationDto } from "../../../lib/config-api";
import { ProjectHarnessConfiguration } from "./project-harness-configuration";

describe("ProjectHarnessConfiguration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("separates current declared configuration from historical Run usage across all five summaries", async () => {
    const client = {
      getEnergyProjectHarnessConfiguration: vi.fn().mockResolvedValue(configuration()),
    };

    await act(async () => {
      root.render(<ProjectHarnessConfiguration projectId="preschool-demo" client={client} />);
    });

    expect(client.getEnergyProjectHarnessConfiguration).toHaveBeenCalledWith("preschool-demo");
    expect(container.textContent).toContain("Harness Configuration");
    expect(container.textContent).toContain("Current configuration");
    expect(container.textContent).toContain("not historical Run evidence");
    expect(container.textContent).toContain("Harness overview");
    expect(container.textContent).toContain("Models & Routing");
    expect(container.textContent).toContain("Skills & Methods");
    expect(container.textContent).toContain("Tools & MCP");
    expect(container.textContent).toContain("Context & Instructions");
    expect(container.textContent).toContain("Resolved per run");
    expect(container.textContent).toContain("Fixed stage contract");
    expect(container.textContent).toContain("Declared for this Harness");
    expect(container.textContent).toContain("Registered is not called");
    expect(container.textContent).toContain("Persisted test snapshot");
    expect(container.textContent).toContain("Verified model default");
    expect(container.textContent).toContain("1,000,000 tokens");
    expect(container.textContent).not.toContain("Actually used");
    const technical = container.querySelector<HTMLDetailsElement>("details[data-harness-technical]");
    expect(technical?.open).toBe(false);
    expect(technical?.querySelector("summary")?.textContent).toContain("Technical IDs");
  });

  it("keeps empty and locally unavailable resource states explicit", async () => {
    const state = configuration();
    state.resources.models = [];
    state.resources.skills = [];
    state.resources.methods = [];
    state.resources.tools = [];
    state.resources.mcpServers = [];
    const client = {
      getEnergyProjectHarnessConfiguration: vi.fn().mockResolvedValue(state),
    };

    await act(async () => {
      root.render(<ProjectHarnessConfiguration projectId="preschool-demo" client={client} />);
    });

    expect(container.textContent).toContain("Local availability needs attention");
    expect(container.textContent).toContain("Workspace scope is declared but not storage-backed.");
    expect(container.textContent).toContain("No configured model resource is locally available");
    expect(container.textContent).toContain("No current Skills are visible");
    expect(container.textContent).toContain("No published Method is declared");
    expect(container.textContent).toContain("No Tools are registered or declared");
    expect(container.textContent).toContain("No MCP server is configured");
  });
});

function configuration(): EnergyProjectHarnessConfigurationDto {
  return {
    status: "partially-unavailable",
    detail: "Current Harness configuration is available with one or more locally unavailable resources.",
    project: {
      id: "preschool-demo",
      name: "Preschool Portfolio",
      workspaceId: "preschool-demo-org",
      rendererKey: "preschool-overview",
    },
    resources: {
      models: [{
        id: "system-model",
        name: "System analysis model",
        source: "server-system-binding",
        status: "connected",
        revision: 3,
        enabled: true,
        provider: "openai-compatible",
        modelName: "deepseek-v4-flash",
        planningContext: {
          capabilitySource: "verified-model-default",
          contextWindow: 1_000_000,
          maxOutputTokens: 32_000,
          outputReserve: 32_000,
          safetyMargin: 4_096,
          inputBudget: 963_904,
        },
      }, {
        id: "analyst-model",
        name: "Analyst model",
        source: "current-admin-resource",
        status: "connected",
        revision: 2,
        enabled: true,
        provider: "openai-compatible",
        modelName: "analyst-model",
        planningContext: {
          capabilitySource: "explicit-profile",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          outputReserve: 4_096,
          safetyMargin: 4_096,
          inputBudget: 119_808,
        },
      }],
      skills: [{
        id: "investigation-skill",
        name: "Investigation Skill",
        description: "Investigate energy patterns with evidence.",
        version: "2.0.0",
        revision: 2,
        status: "valid",
        enabled: true,
        physicalOwner: "user",
        declaredScope: "workspace",
        scopeStatus: "unverified",
        availability: "unavailable",
        allowedToolIds: ["run_sql_readonly"],
        deniedToolIds: [],
        contentSha256: "a".repeat(64),
      }],
      methods: [{
        resourceId: "method:open-discovery@2",
        resourceRevision: 2,
        skillId: "open-discovery",
        semanticVersion: "2.0.0",
        role: "core-method",
        scope: "builtin",
        contentSha256: "b".repeat(64),
        lifecycle: "published",
      }],
      tools: [{
        id: "energy.evidence.read",
        source: "energyiq-server-owned",
        availability: "declared-for-stage",
      }, {
        id: "run_sql_readonly",
        source: "datafoundry-builtin",
        availability: "registered",
      }],
      mcpServers: [{
        id: "forecast-mcp",
        name: "Forecast MCP",
        revision: 4,
        status: "connected",
        enabled: true,
        physicalOwner: "user",
        availability: "configured",
        connection: "persisted-status",
        statusAsOf: "2026-08-15T10:00:00.000Z",
        toolManifest: { source: "persisted-last-test", toolNames: ["forecast_read"] },
      }],
    },
    harnesses: [{
      id: "ai-analyst",
      label: "AI Analyst",
      resolution: "run-dependent",
      status: "available",
      detail: "Candidates are resolved per Run.",
      modelIds: ["analyst-model"],
      skillIds: [],
      methodResourceIds: [],
      toolIds: ["run_sql_readonly"],
      mcpServerIds: ["forecast-mcp"],
      context: { mode: "run-planned", sources: ["conversation", "evidence", "tool-observations"] },
      instructions: [{
        kind: "platform",
        label: "DataFoundry platform instructions",
        revision: null,
        revisionStatus: "not-separately-versioned",
        visibility: "summary-only",
      }],
    }, {
      id: "additional-insights",
      label: "Additional Insights",
      resolution: "fixed-stage-contract",
      status: "available",
      detail: "Server-owned Method set and scoped read-only Tools.",
      modelIds: ["system-model"],
      skillIds: [],
      methodResourceIds: ["method:open-discovery@2"],
      toolIds: ["energy.evidence.read"],
      mcpServerIds: [],
      context: { mode: "run-planned", sources: ["project-identity", "evidence-catalog"] },
      instructions: [{
        kind: "workflow-stage",
        label: "Additional Insights workflow prompt",
        revision: null,
        revisionStatus: "run-pinned",
        visibility: "summary-only",
      }],
    }],
    unavailable: [{
      id: "investigation-skill",
      detail: "Workspace scope is declared but not storage-backed.",
    }],
  };
}
