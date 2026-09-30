/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectAiOperationsDto } from "../../../lib/config-api";
import { ProjectAiOperations } from "./project-ai-operations";

describe("ProjectAiOperations Skill evidence states", () => {
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

  it("does not present materialized Skill evidence as loaded or read", async () => {
    const list = operations(false);
    const detail = operations(true);
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn().mockResolvedValue(detail),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="ngee-ann-polytechnic" client={client} />);
    });
    const view = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("View trace"));
    await act(async () => view?.click());

    expect(container.textContent).toContain("Actually materialized");
    expect(container.textContent).toContain("Open Discovery · revision 2");
    expect(container.textContent).toContain("Loaded / read by Runtime");
    expect(container.textContent).toContain("Load/read evidence is unavailable for this Run");
    expect(container.textContent).toContain("Materialized does not prove loaded or read");
  });

  it("summarizes exact loaded evidence while keeping technical identity folded and bad siblings local", async () => {
    const list = operations(false);
    const detail = operations(true);
    detail.selectedRun!.historicalConfiguration.loadedSkills = {
      status: "available",
      items: [{
        contentSha256: `sha256:${"a".repeat(64)}`,
        detail: "Exact Skill content was read and assembled for this Run.",
        evidenceStatus: "available",
        id: "data-analysis",
        loadSource: "materialized-skill-package",
        loadStage: "agent-instruction-assembly",
        name: "Data Analysis",
        ownerScope: "workspace",
        ownerUserId: "dev-user",
        ownerWorkspaceId: "default",
        packageRef: "file-ref-data-analysis-v1",
        revision: 7,
        semanticVersion: "1.0.0",
      }, {
        contentSha256: `sha256:${"b".repeat(64)}`,
        detail: "Skill load identity did not match this Run's selected revision and materialized package evidence.",
        evidenceStatus: "unavailable",
        id: "broken-sibling",
        loadSource: "materialized-skill-package",
        loadStage: "agent-instruction-assembly",
        name: "Broken Sibling",
        ownerScope: "workspace",
        ownerUserId: "dev-user",
        ownerWorkspaceId: "default",
        packageRef: "file-ref-broken-v1",
        revision: 4,
        semanticVersion: "1.0.0",
      }, {
        contentSha256: null,
        detail: "The Skill was selected or materialized, but no exact skill.loaded event was persisted for this Run.",
        evidenceStatus: "unavailable",
        id: "missing-load",
        loadSource: null,
        loadStage: null,
        name: null,
        ownerScope: null,
        ownerUserId: null,
        ownerWorkspaceId: null,
        packageRef: null,
        revision: 5,
        semanticVersion: null,
      }],
    };
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn().mockResolvedValue(detail),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="ngee-ann-polytechnic" client={client} />);
    });
    const view = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("View trace"));
    await act(async () => view?.click());

    const loadedHeading = Array.from(container.querySelectorAll("h4"))
      .find((heading) => heading.textContent === "Loaded / read by Runtime");
    const loadedBlock = loadedHeading?.closest("section");
    expect(loadedBlock?.textContent).toContain("Data Analysis · version 1.0.0");
    expect(loadedBlock?.textContent).toContain("Loaded for this Run");
    expect(loadedBlock?.textContent).toContain("Exact Skill content was read and assembled for this Run.");
    expect(loadedBlock?.textContent).toContain("Broken Sibling · version 1.0.0");
    expect(loadedBlock?.textContent).toContain("Missing Load · revision 5");
    expect(loadedBlock?.textContent).toContain("Evidence unavailable");
    const technical = loadedBlock?.querySelectorAll<HTMLDetailsElement>("details[data-ai-operations-technical]");
    expect(technical).toHaveLength(3);
    expect([...technical ?? []].every((item) => item.open === false)).toBe(true);
  });
});

function operations(withDetail: boolean): EnergyProjectAiOperationsDto {
  const summary = {
    runId: "run-skill-evidence",
    actorId: "dev-user",
    sessionId: "session-skill-evidence",
    status: "completed",
    stage: "additional-insights-discovery",
    modelProvider: "openai-compatible",
    modelName: "historical-model",
    startedAt: "2026-08-23T00:00:00.000Z",
    finishedAt: "2026-08-23T00:00:04.000Z",
    latencyMs: 4_000,
    parentRunId: null,
    errorCode: null,
    inputTokens: 100,
    outputTokens: 20,
    toolCounts: { called: 0, succeeded: 0, rejected: 0, failed: 0 },
    traceAvailability: "partial",
  } as const;
  return {
    project: { id: "ngee-ann-polytechnic", name: "Ngee Ann Polytechnic", workspaceId: "default" },
    runs: [summary],
    pagination: { limit: 20, returned: 1, hasMore: false, nextCursor: null },
    selectedRun: withDetail ? {
      ...summary,
      historicalConfiguration: {
        status: "available",
        detail: "Historical evidence only.",
        modelProfileId: "historical-model-profile",
        resourceRevisions: { "skill:open-discovery": 2 },
        selectedSkills: [{ id: "open-discovery", name: "Open Discovery", revision: 2 }],
        selectionAudit: { selected: 1, rejected: 0, unavailable: 0 },
        materializedSkills: { status: "available", items: [{ id: "open-discovery", revision: 2 }] },
        loadedSkills: { status: "unavailable", items: [] },
        mcp: { enabledServerIds: [], serverToolMapping: { status: "available", items: [] } },
      },
      context: { status: "unavailable", steps: [] },
      modelRequests: {
        status: "unavailable",
        detail: "This historical Run has no Provider-boundary request snapshot.",
        items: [],
      },
      tools: [],
      tokens: { status: "available", input: 100, output: 20, total: 120, cache: { status: "unavailable", hit: null, miss: null } },
      lineage: { artifacts: [], energyIqArtifacts: [] },
    } : null,
  } as unknown as EnergyProjectAiOperationsDto;
}
