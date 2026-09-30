/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectAiOperationsDto } from "../../../lib/config-api";
import { ProjectAiOperations } from "./project-ai-operations";

describe("ProjectAiOperations", () => {
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

  it("loads the Project Run list first and reveals exact historical evidence only on demand", async () => {
    const list = operations();
    const detail = operations();
    detail.selectedRun = runDetail();
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn().mockResolvedValue(detail),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });

    expect(client.getEnergyProjectAiOperations).toHaveBeenCalledWith("preschool-demo");
    expect(client.getEnergyProjectAiOperationsRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("AI Operations");
    expect(container.textContent).toContain("Historical Run evidence");
    expect(container.querySelector("h4")?.textContent).toBe("Open trace to load");
    expect(container.textContent).toContain("Open trace to load evidence");
    expect(container.textContent).not.toContain("2,900 tokens");

    const view = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("View trace"));
    await act(async () => view?.click());

    expect(client.getEnergyProjectAiOperationsRun).toHaveBeenCalledWith("preschool-demo", "analyst-1", "run-1");
    expect(container.textContent).toContain("Historical effective configuration");
    expect(container.textContent).toContain("Current configuration changes never rewrite this trace");
    expect(container.textContent).toContain("Selected for Run");
    expect(container.textContent).toContain("Actually materialized");
    expect(container.textContent).toContain("MCP server-to-tool mapping unavailable");
    expect(container.textContent).toContain("Current manifest was not substituted");
    expect(container.textContent).toContain("Context plan");
    expect(container.textContent).toContain("Model requests");
    expect(container.textContent).toContain("1 of 2 Provider-boundary request snapshots can be reconstructed");
    expect(container.textContent).toContain("Request 1 · Available");
    expect(container.textContent).toContain("Request 2 · Unavailable");
    expect(container.textContent).toContain("Payload retention");
    expect(container.textContent).toContain("1 selected group");
    expect(container.textContent).toContain("1 omitted group");
    expect(container.textContent).toContain("1 truncation decision");
    expect(container.textContent).toContain("Tool calls");
    expect(container.textContent).toContain("Succeeded");
    expect(container.textContent).toContain("Rejected");
    expect(container.textContent).toContain("Token usage");
    expect(container.textContent).toContain("Artifact & Finding lineage");
    expect(container.textContent).not.toContain("private prompt body");
    const technical = container.querySelector<HTMLDetailsElement>("details[data-ai-operations-technical]");
    expect(technical?.open).toBe(false);
    expect(technical?.querySelector("summary")?.textContent).toContain("Technical IDs");
  });

  it("shows the bounded page and loads older Runs from the server cursor", async () => {
    const first = operations();
    first.pagination = { limit: 20, returned: 1, hasMore: true, nextCursor: "cursor-1" };
    const second = operations();
    second.runs = [{ ...second.runs[0]!, runId: "run-older" }];
    second.pagination = { limit: 20, returned: 1, hasMore: false, nextCursor: null };
    const client = {
      getEnergyProjectAiOperations: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      getEnergyProjectAiOperationsRun: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });
    expect(container.textContent).toContain("Pages contain up to 20 Runs");
    const loadOlder = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Load older Runs"));
    await act(async () => loadOlder?.click());

    expect(client.getEnergyProjectAiOperations).toHaveBeenNthCalledWith(2, "preschool-demo", { cursor: "cursor-1" });
    expect(container.textContent).toContain("run-older");
    expect(container.textContent).not.toContain("Load older Runs");
  });

  it("keeps an empty Project explicit without requesting a detail trace", async () => {
    const state = operations();
    state.runs = [];
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(state),
      getEnergyProjectAiOperationsRun: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });

    expect(container.textContent).toContain("No persisted Runs are available for this Project");
    expect(container.textContent).toContain("Current Harness configuration is not used to fill this gap");
    expect(client.getEnergyProjectAiOperationsRun).not.toHaveBeenCalled();
  });

  it("ignores a stale Run detail response after a newer actor-plus-Run selection wins", async () => {
    const list = operations();
    list.runs.push({ ...list.runs[0]!, actorId: "analyst-2", runId: "run-2", sessionId: "session-2" });
    const stale = deferred<EnergyProjectAiOperationsDto>();
    const staleDetail = operations();
    staleDetail.selectedRun = {
      ...runDetail(),
      historicalConfiguration: {
        ...runDetail().historicalConfiguration,
        detail: "Stale trace for analyst one.",
      },
    };
    const currentDetail = operations();
    currentDetail.selectedRun = {
      ...runDetail(),
      actorId: "analyst-2",
      runId: "run-2",
      sessionId: "session-2",
      historicalConfiguration: {
        ...runDetail().historicalConfiguration,
        detail: "Current trace for analyst two.",
      },
    };
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn((_: string, actorOrRunId: string, exactRunId?: string) => {
        const runId = exactRunId ?? actorOrRunId;
        return runId === "run-1" ? stale.promise : Promise.resolve(currentDetail);
      }),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });
    const viewButtons = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("View trace"));
    await act(async () => viewButtons[0]?.click());
    await act(async () => viewButtons[1]?.click());
    expect(container.textContent).toContain("Current trace for analyst two.");

    await act(async () => {
      stale.resolve(staleDetail);
      await stale.promise;
    });
    expect(container.textContent).toContain("Current trace for analyst two.");
    expect(container.textContent).not.toContain("Stale trace for analyst one.");
  });

  it("shows missing token evidence as unavailable instead of inferred zeroes", async () => {
    const list = operations();
    const detail = operations();
    detail.selectedRun = {
      ...runDetail(),
      tokens: {
        status: "unavailable",
        input: null,
        output: null,
        total: null,
        cache: { status: "unavailable", hit: null, miss: null },
      },
    };
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn().mockResolvedValue(detail),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });
    const view = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("View trace"));
    await act(async () => view?.click());
    const tokenHeading = Array.from(container.querySelectorAll("h4"))
      .find((heading) => heading.textContent === "Token usage");
    const tokenPanel = tokenHeading?.closest("section");
    expect(tokenPanel?.textContent).toContain("Unavailable");
    expect(tokenPanel?.textContent).toContain("Token usage evidence is unavailable for this Run");
    expect(tokenPanel?.textContent).not.toContain("Input0");
    expect(tokenPanel?.textContent).not.toContain("Output0");
    expect(tokenPanel?.textContent).not.toContain("Total0");
  });

  it("shows persisted true-zero token evidence as available zeroes", async () => {
    const list = operations();
    const detail = operations();
    detail.selectedRun = {
      ...runDetail(),
      inputTokens: 0,
      outputTokens: 0,
      tokens: {
        status: "available",
        input: 0,
        output: 0,
        total: 0,
        cache: { status: "unavailable", hit: null, miss: null },
      },
    };
    const client = {
      getEnergyProjectAiOperations: vi.fn().mockResolvedValue(list),
      getEnergyProjectAiOperationsRun: vi.fn().mockResolvedValue(detail),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });
    const view = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("View trace"));
    await act(async () => view?.click());
    const tokenHeading = Array.from(container.querySelectorAll("h4"))
      .find((heading) => heading.textContent === "Token usage");
    const tokenPanel = tokenHeading?.closest("section");
    expect(tokenPanel?.textContent).toContain("Available");
    expect(tokenPanel?.textContent).toContain("Input0");
    expect(tokenPanel?.textContent).toContain("Output0");
    expect(tokenPanel?.textContent).toContain("Total0");
    expect(tokenPanel?.textContent).not.toContain("Token usage evidence is unavailable for this Run");
  });

  it("does not merge an older page response into a newly selected Project", async () => {
    const projectA = operations();
    projectA.pagination = { limit: 20, returned: 1, hasMore: true, nextCursor: "project-a-cursor" };
    const projectB = operations();
    projectB.project = { id: "ngee-ann-polytechnic", name: "Ngee Ann Polytechnic", workspaceId: "default" };
    projectB.runs = [{ ...projectB.runs[0]!, actorId: "ngee-actor", runId: "ngee-run" }];
    const stalePage = operations();
    stalePage.runs = [{ ...stalePage.runs[0]!, runId: "stale-project-a-run" }];
    stalePage.pagination = { limit: 20, returned: 1, hasMore: false, nextCursor: null };
    const pendingPage = deferred<EnergyProjectAiOperationsDto>();
    const client = {
      getEnergyProjectAiOperations: vi.fn((projectId: string, options?: { cursor?: string }) => {
        if (options?.cursor) return pendingPage.promise;
        return Promise.resolve(projectId === "preschool-demo" ? projectA : projectB);
      }),
      getEnergyProjectAiOperationsRun: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectAiOperations projectId="preschool-demo" client={client} />);
    });
    const loadOlder = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Load older Runs"));
    await act(async () => loadOlder?.click());
    await act(async () => {
      root.render(<ProjectAiOperations projectId="ngee-ann-polytechnic" client={client} />);
    });

    await act(async () => {
      pendingPage.resolve(stalePage);
      await pendingPage.promise;
    });
    expect(container.textContent).toContain("Ngee Ann Polytechnic");
    expect(container.textContent).toContain("ngee-run");
    expect(container.textContent).not.toContain("stale-project-a-run");
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function operations(): EnergyProjectAiOperationsDto {
  return {
    project: { id: "preschool-demo", name: "Preschool Portfolio", workspaceId: "preschool-demo-org" },
    runs: [{
      runId: "run-1",
      actorId: "analyst-1",
      sessionId: "session-1",
      status: "completed",
      stage: null,
      modelProvider: "openai-compatible",
      modelName: "historical-model",
      startedAt: "2026-08-15T10:00:00.000Z",
      finishedAt: "2026-08-15T10:00:08.000Z",
      latencyMs: 8_000,
      parentRunId: null,
      errorCode: null,
      inputTokens: null,
      outputTokens: null,
      toolCounts: null,
      traceAvailability: "detail-required",
    }],
    selectedRun: null,
    pagination: { limit: 20, returned: 1, hasMore: false, nextCursor: null },
  };
}

function runDetail(): NonNullable<EnergyProjectAiOperationsDto["selectedRun"]> {
  return {
    ...operations().runs[0]!,
    stage: "additional-insights",
    inputTokens: 2_400,
    outputTokens: 500,
    toolCounts: { called: 3, succeeded: 2, rejected: 1, failed: 0 },
    traceAvailability: "partial",
    historicalConfiguration: {
      status: "available",
      detail: "Historical effective configuration comes only from this Run's persisted events.",
      modelProfileId: "historical-model-profile",
      resourceRevisions: { "skill:open-discovery": 2 },
      selectedSkills: [{ id: "open-discovery", name: "Open Discovery", revision: 2 }],
      selectionAudit: { selected: 1, rejected: 2, unavailable: 1 },
      loadedSkills: { status: "available", items: [{ id: "open-discovery", revision: 2 }] },
      mcp: {
        enabledServerIds: ["forecast-mcp"],
        serverToolMapping: { status: "unavailable", items: [] },
      },
    },
    context: {
      status: "available",
      steps: [{
        stepNumber: 1,
        packageId: "additional-insights-context",
        packageRevision: 3,
        planId: "plan-1",
        selectedGroupCount: 1,
        omittedGroupCount: 1,
        selectedSourceTypes: ["evidence"],
        omittedSourceTypes: ["conversation"],
        truncationDecisionCount: 1,
        promptTokens: 2_400,
        inputBudget: 96_000,
        contextWindow: 128_000,
        remainingTokens: 93_600,
        capabilitySource: "explicit-profile",
        highWaterMark: "below-budget",
      }],
    },
    modelRequests: {
      status: "partial",
      detail: "1 of 2 Provider-boundary request snapshots can be reconstructed.",
      items: [{
        stepNumber: 1,
        retryCount: 0,
        modelName: "historical-model",
        reconstructionStatus: "available",
        snapshotId: "model-request:run-1:1:0",
        contentSha256: `sha256:${"a".repeat(64)}`,
        contextPackageId: "additional-insights-context",
        contextPackageRevision: 3,
        toolNames: ["energy.evidence.read"],
        payloadAvailability: "retained",
      }, {
        stepNumber: 2,
        retryCount: 0,
        modelName: "historical-model",
        reconstructionStatus: "unavailable",
        snapshotId: "model-request:run-1:2:0",
        contentSha256: `sha256:${"b".repeat(64)}`,
        contextPackageId: "missing-context",
        contextPackageRevision: 4,
        toolNames: [],
        payloadAvailability: "not-retained",
      }],
    },
    tools: [{
      toolCallId: "tool-1",
      name: "energy.evidence.read",
      status: "succeeded",
      startedAt: "2026-08-15T10:00:01.000Z",
      finishedAt: "2026-08-15T10:00:02.000Z",
    }, {
      toolCallId: "tool-2",
      name: "run_sql_readonly",
      status: "rejected",
      startedAt: "2026-08-15T10:00:03.000Z",
      finishedAt: "2026-08-15T10:00:04.000Z",
    }],
    tokens: {
      status: "available",
      input: 2_400,
      output: 500,
      total: 2_900,
      cache: { status: "unavailable", hit: null, miss: null },
    },
    lineage: {
      artifacts: [{ id: "artifact-1", type: "analysis", name: "Additional Insights" }],
      energyIqArtifacts: [{
        id: "energy-artifact-1",
        kind: "additional-insights",
        targetId: "additional-insights",
        findingIds: ["finding-1"],
      }],
    },
  };
}
