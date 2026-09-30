import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";

describe("Project AI Operations client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads Project-scoped historical Run list and detail without mutation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: {
        project: { id: "preschool-demo", name: "Preschool Portfolio", workspaceId: "preschool-demo-org" },
        runs: [],
        selectedRun: null,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyProjectAiOperations("preschool-demo");
    await configApi.getEnergyProjectAiOperations("preschool-demo", { cursor: "cursor-1", limit: 20 });
    await configApi.getEnergyProjectAiOperationsRun("preschool-demo", "analyst-1", "run-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/api/v1/energy/projects/preschool-demo/ai-operations"),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/energy/projects/preschool-demo/ai-operations?cursor=cursor-1&limit=20"),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/api/v1/energy/projects/preschool-demo/ai-operations/runs/run-1?actorId=analyst-1"),
      expect.any(Object),
    );
    expect(fetchMock.mock.calls.every(([, init]) => !init || !("method" in init) || init.method === "GET")).toBe(true);
  });
});
