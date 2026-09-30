import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";

describe("Project Harness Configuration client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the server-owned current configuration without mutation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "partially-unavailable",
        project: {
          id: "preschool-demo",
          name: "Preschool Portfolio",
          workspaceId: "preschool-demo-org",
          rendererKey: "preschool-overview",
        },
        resources: { models: [], skills: [], methods: [], tools: [], mcpServers: [] },
        harnesses: [],
        unavailable: [],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyProjectHarnessConfiguration("preschool-demo");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/energy/projects/preschool-demo/harness-configuration"),
      expect.any(Object),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({ method: "POST" });
  });
});
