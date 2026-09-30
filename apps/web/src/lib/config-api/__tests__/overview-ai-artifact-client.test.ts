import { afterEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";

describe("Overview AI Artifact client controls", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE;
    vi.unstubAllGlobals();
  });

  it("starts server-owned materialization through a CSRF-protected ensure POST", async () => {
    process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE = "password";
    vi.stubGlobal("document", { cookie: "df_csrf=csrf-token" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "queued",
        dataSnapshotId: "snapshot-1",
        projectReleaseId: "release-1",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.ensureEnergyOverviewAiArtifact("preschool-demo", "preschool-portfolio");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/overview-ai-artifact/ensure?scopeId=preschool-portfolio"),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
  });

  it("pins the Artifact request to the Snapshot and period visible on the Overview", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "missing",
        dataSnapshotId: "snapshot-may",
        projectReleaseId: "release-may",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyOverviewAiArtifact("preschool-demo", "preschool-project", {
      from: "2026-05-01",
      to: "2026-05-31",
      dataSnapshotId: "snapshot-may",
      projectReleaseId: "release-may",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("scopeId=preschool-project&from=2026-05-01&to=2026-05-31&dataSnapshotId=snapshot-may&projectReleaseId=release-may"),
      expect.any(Object),
    );
  });

  it("restores the project Overview AI read model through GET only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        contract: "energyiq-project-overview-ai-read-model@1",
        rendererKey: "ngee-ann-overview",
        binding: {},
        keyFindings: { status: "missing" },
        sections: {},
        additionalInsights: { status: "missing" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyProjectOverviewAiReadModel("ngee-ann-polytechnic", "project");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/ngee-ann-polytechnic/overview-ai-artifact?scopeId=project"),
      expect.not.objectContaining({ method: "POST" }),
    );
  });

  it("sends only the selected failed Section as the retry target", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        status: "available",
        dataSnapshotId: "snapshot-may",
        projectReleaseId: "release-may",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.retryEnergyOverviewAiArtifact(
      "preschool-demo",
      "preschool-project",
      {
        from: "2026-05-01",
        to: "2026-05-31",
        dataSnapshotId: "snapshot-may",
        projectReleaseId: "release-may",
      },
      "standby-wastage",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/overview-ai-artifact/retry?"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ targetId: "standby-wastage" }) }),
    );
  });

  it("reads the server-owned Admin readiness model without mutation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: {
        projectId: "preschool-demo",
        projectName: "Preschool Portfolio",
        rendererKey: "preschool-overview",
        customerOverview: { status: "ready", detail: "Available", url: "/energyiq/overview?projectId=preschool-demo" },
        currentIdentity: null,
        capabilities: { keyFindings: true, sectionAnalysis: [], additionalInsights: true },
        analysis: { supported: true, status: "not-generated", detail: "Missing", readyCount: 0, totalCount: 6, lastGeneratedAt: null, items: [] },
        allowedActions: ["generate-missing"],
        recommendedNextAction: { action: "generate-missing", label: "Generate missing analysis", detail: "Create missing results" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.getEnergyProjectOverviewAdminState("preschool-demo");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/energy/projects/preschool-demo/overview-admin-state"),
      expect.any(Object),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({ method: "POST" });
  });

  it("requests Generate missing analysis through the CSRF-protected project action", async () => {
    process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE = "password";
    vi.stubGlobal("document", { cookie: "df_csrf=csrf-token" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        projectId: "preschool-demo",
        projectName: "Preschool Portfolio",
        rendererKey: "preschool-overview",
        customerOverview: { status: "ready", detail: "Available", url: "/energyiq/overview?projectId=preschool-demo" },
        currentIdentity: null,
        capabilities: { keyFindings: true, sectionAnalysis: [], additionalInsights: true },
        analysis: { supported: true, status: "ready", detail: "Ready", readyCount: 6, totalCount: 6, lastGeneratedAt: null, items: [] },
        allowedActions: [],
        recommendedNextAction: null,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await configApi.generateMissingEnergyProjectOverviewAnalysis("preschool-demo");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/preschool-demo/overview-admin-state/actions/generate-missing"),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
  });
});
