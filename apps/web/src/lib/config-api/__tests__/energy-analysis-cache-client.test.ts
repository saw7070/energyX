import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";

describe("configApi.resolveProjectAnalysis cache control", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a continued EnergyX Session through the server-owned atomic endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        session: { id: "session-current", threadId: "session-current" },
        energyContext: { dataSnapshotId: "snapshot-current" },
      },
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.continueEnergySessionOnCurrent({
      sourceSessionId: "session-historical",
      target: {
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity",
      },
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/energy/analysis/sessions/continue-current",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      sourceSessionId: "session-historical",
      target: {
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity",
      },
    });
  });

  it("adds bypassCache only to the explicit refresh transport body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: "configuration-required" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity" as const,
      period: "Custom" as const,
      from: "2026-05-01",
      to: "2026-05-31",
    };

    await configApi.resolveProjectAnalysis(request);
    await configApi.resolveProjectAnalysis(request, { bypassCache: true });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(request);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      ...request,
      bypassCache: true,
    });
    expect(request).not.toHaveProperty("bypassCache");
  });

  it("keeps only canonical Managed current Overview bypass requests on the read-only projection route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: "ready", snapshot: {} },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.resolveProjectAnalysis({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      analysisWindow: "current-project-overview",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      expectedDataSnapshotId: "snapshot-current",
      expectedProjectReleaseId: "release-current",
    }, { bypassCache: true });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/energy/projects/preschool-demo/overview-projection"
      + "?expectedDataSnapshotId=snapshot-current&expectedProjectReleaseId=release-current"
      + "&expectedFrom=2026-06-01T00%3A00%3A00.000Z&expectedTo=2026-07-01T00%3A00%3A00.000Z",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();

    fetchMock.mockClear();
    for (const noncanonicalIdentity of [
      { scopeId: "level-1", resource: "electricity" },
      { scopeId: "project", resource: "water" },
    ] as const) {
      await expect(configApi.resolveProjectAnalysis({
        projectId: "preschool-demo",
        ...noncanonicalIdentity,
        analysisWindow: "current-project-overview",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
      }, { bypassCache: true })).rejects.toThrow(
        "ENERGYIQ_CURRENT_PROJECT_OVERVIEW_CONTEXT_INVALID",
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the admin projection publication route for explicit recompute", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { changed: true, identity: {}, evidenceRefs: [] },
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.materializeCurrentProjectOverview("preschool/demo");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/energy/projects/preschool%2Fdemo/overview-projection",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("loads mutable Overview lifecycle through an exact projection ref", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        contract: "energyiq-overview-lifecycle@1",
        projectionRef: "sha256:projection-current",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getCurrentProjectOverviewLifecycle(
      "preschool/demo",
      "sha256:projection-current",
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/energy/projects/preschool%2Fdemo/overview-lifecycle"
      + "?expectedProjectionRef=sha256%3Aprojection-current",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("reads the Ngee Ann AI model with the exact Snapshot and Release pin", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { status: "missing" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyProjectOverviewAiReadModel("ngee-ann-polytechnic", "project", {
      from: "2026-08-01",
      to: "2026-08-19",
      dataSnapshotId: "snapshot-v10",
      projectReleaseId: "release-v10",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/energy/projects/ngee-ann-polytechnic/overview-ai-artifact?scopeId=project"
      + "&from=2026-08-01&to=2026-08-19&dataSnapshotId=snapshot-v10&projectReleaseId=release-v10",
    );
  });

  it("reads the current minimum Overview through the dedicated GET contract", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "ready",
        contract: "energyiq-current-overview-minimum@2",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyProjectOverviewMinimum("ngee-ann/polytechnic");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/energy/projects/ngee-ann%2Fpolytechnic/overview-minimum",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});
