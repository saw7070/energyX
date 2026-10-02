/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyAccessContextDto, EnergyProjectDto } from "../../../lib/config-api";
import { EnergyIqAccessProvider, useEnergyIqAccess } from "./energyiq-access";

const configApiMock = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  getEnergyAccessContext: vi.fn<() => Promise<EnergyAccessContextDto>>(),
  setWorkspaceId: vi.fn<(workspaceId: string | null) => void>(),
}));

vi.mock("../../../lib/config-api", () => ({
  configApi: {
    getEnergyAccessContext: configApiMock.getEnergyAccessContext,
  },
  setConfigApiWorkspaceId: (workspaceId: string | null) => {
    configApiMock.activeWorkspaceId = workspaceId;
    configApiMock.setWorkspaceId(workspaceId);
  },
}));

describe("EnergyX access deep-link recovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    configApiMock.activeWorkspaceId = null;
    configApiMock.getEnergyAccessContext.mockReset();
    configApiMock.setWorkspaceId.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("energyiq:active-organisation:v1", "tuya-office");
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=ngee-ann-polytechnic&currentDataSnapshotId=snapshot-v10#ngee-ann-summary-findings",
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("restores an administrator draft report project in a workspace with no published Overview", async () => {
    window.history.replaceState({}, "", "/energyiq/reports?projectId=first-report");
    const draft = { ...project("first-report", "tuya-office"), status: "draft" as const };
    configApiMock.getEnergyAccessContext.mockResolvedValue(accessContext("tuya-office", [draft]));
    await act(async () => root.render(<EnergyIqAccessProvider><AccessProbe /></EnergyIqAccessProvider>));
    expect(container.textContent).toBe("ready:tuya-office:first-report");
  });
  it("does not restore a draft project for a normal user", async () => {
    window.history.replaceState({}, "", "/energyiq/library?projectId=first-report");
    const draft = { ...project("first-report", "tuya-office"), status: "draft" as const };
    const context = { ...accessContext("tuya-office", [draft, project("published", "tuya-office")]), role: "user" as const };
    configApiMock.getEnergyAccessContext.mockResolvedValue(context);
    await act(async () => root.render(<EnergyIqAccessProvider><AccessProbe /></EnergyIqAccessProvider>));
    expect(container.textContent).toBe("ready:tuya-office:published");
  });
  it("recovers an authorised Project deep link from a different active Workspace", async () => {
    const tuya = accessContext("tuya-office", [project("tuya-office", "tuya-office")]);
    const ngeeAnn = accessContext(
      "ngee-ann-workspace",
      [project("ngee-ann-polytechnic", "ngee-ann-workspace")],
    );
    configApiMock.getEnergyAccessContext.mockImplementation(async () => {
      if (configApiMock.activeWorkspaceId === "ngee-ann-workspace") return ngeeAnn;
      return tuya;
    });

    await act(async () => {
      root.render(
        <EnergyIqAccessProvider>
          <AccessProbe />
        </EnergyIqAccessProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toBe("ready:ngee-ann-workspace:ngee-ann-polytechnic");
    });
    expect(configApiMock.setWorkspaceId).toHaveBeenCalledWith("ngee-ann-workspace");
    expect(window.location.search).toContain("projectId=ngee-ann-polytechnic");
    expect(window.location.hash).toBe("#ngee-ann-summary-findings");
  });

  it("keeps the original Workspace when the requested Project is not authorised", async () => {
    const tuya = accessContext("tuya-office", [project("tuya-office", "tuya-office")]);
    const ngeeAnn = accessContext(
      "ngee-ann-workspace",
      [project("ngee-ann-polytechnic", "ngee-ann-workspace")],
    );
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&currentDataSnapshotId=private-snapshot",
    );
    configApiMock.getEnergyAccessContext.mockImplementation(async () => {
      if (configApiMock.activeWorkspaceId === "ngee-ann-workspace") return ngeeAnn;
      return tuya;
    });

    await act(async () => {
      root.render(
        <EnergyIqAccessProvider>
          <AccessProbe />
        </EnergyIqAccessProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toBe("ready:tuya-office:tuya-office");
    });
    expect(configApiMock.getEnergyAccessContext).toHaveBeenCalledTimes(2);
    expect(configApiMock.activeWorkspaceId).toBe("tuya-office");
    expect(window.localStorage.getItem("energyiq:active-organisation:v1")).toBe("tuya-office");
  });

  it("honours a manual Workspace switch instead of recovering the previous URL Project", async () => {
    const workspaces = [
      { id: "preschool-workspace", name: "Preschool", kind: "customer" as const, disabled: false },
      { id: "tuya-office", name: "Tuya Office", kind: "customer" as const, disabled: false },
    ];
    const preschool = {
      ...accessContext(
        "preschool-workspace",
        [project("preschool-demo", "preschool-workspace")],
      ),
      workspaces,
    };
    const tuya = {
      ...accessContext("tuya-office", [project("tuya-office", "tuya-office")]),
      workspaces,
    };
    window.localStorage.setItem("energyiq:active-organisation:v1", "preschool-workspace");
    window.history.replaceState(
      {},
      "",
      "/energyiq/overview?projectId=preschool-demo&currentDataSnapshotId=snapshot-preschool",
    );
    const switchedAccess = deferred<EnergyAccessContextDto>();
    configApiMock.getEnergyAccessContext
      .mockResolvedValueOnce(preschool)
      .mockReturnValueOnce(switchedAccess.promise);

    await act(async () => {
      root.render(
        <EnergyIqAccessProvider>
          <ManualWorkspaceSwitchProbe />
        </EnergyIqAccessProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("ready:preschool-workspace:preschool-demo");
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      switchedAccess.resolve(tuya);
      await switchedAccess.promise;
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("ready:tuya-office:tuya-office:return:tuya-office");
    });
    expect(configApiMock.getEnergyAccessContext).toHaveBeenCalledTimes(2);
  });

  it("restores the previous Workspace header when a manual switch cannot load its access context", async () => {
    const workspaces = [
      { id: "preschool-workspace", name: "Preschool", kind: "customer" as const, disabled: false },
      { id: "tuya-office", name: "Tuya Office", kind: "customer" as const, disabled: false },
    ];
    const preschool = {
      ...accessContext(
        "preschool-workspace",
        [project("preschool-demo", "preschool-workspace")],
      ),
      workspaces,
    };
    window.localStorage.setItem("energyiq:active-organisation:v1", "preschool-workspace");
    window.history.replaceState({}, "", "/energyiq/overview?projectId=preschool-demo&currentDataSnapshotId=snapshot-preschool");
    const failedAccess = deferred<EnergyAccessContextDto>();
    configApiMock.getEnergyAccessContext
      .mockResolvedValueOnce(preschool)
      .mockReturnValueOnce(failedAccess.promise);

    await act(async () => {
      root.render(
        <EnergyIqAccessProvider>
          <ManualWorkspaceSwitchProbe />
        </EnergyIqAccessProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("ready:preschool-workspace:preschool-demo");
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      failedAccess.reject(new Error("NETWORK_TIMEOUT"));
      await failedAccess.promise.catch(() => undefined);
    });
    await vi.waitFor(() => {
      // The code itself never reaches the page; the reader gets a sentence they can act on.
      expect(container.textContent).toBe("error:We couldn't reach EnergyX. Check your connection and try again.");
    });

    expect(configApiMock.getEnergyAccessContext).toHaveBeenCalledTimes(2);
    expect(configApiMock.activeWorkspaceId).toBe("preschool-workspace");
    expect(window.localStorage.getItem("energyiq:active-organisation:v1")).toBe("preschool-workspace");
  });

  it("recovers an authorised direct AI Project from a different active Workspace", async () => {
    const preschoolWorkspace = {
      id: "preschool-workspace",
      name: "Preschool",
      kind: "customer" as const,
      disabled: false,
    };
    const tuyaBase = accessContext("tuya-office", [project("tuya-office", "tuya-office")]);
    const tuya = {
      ...tuyaBase,
      workspaces: [...tuyaBase.workspaces, preschoolWorkspace],
    };
    const preschool = {
      ...accessContext(
        "preschool-workspace",
        [project("preschool-demo", "preschool-workspace")],
      ),
      workspaces: tuya.workspaces,
    };
    window.history.replaceState({}, "", "/energyiq/ai?projectId=preschool-demo");
    configApiMock.getEnergyAccessContext.mockImplementation(async () => {
      if (configApiMock.activeWorkspaceId === "preschool-workspace") return preschool;
      return tuya;
    });

    await act(async () => {
      root.render(
        <EnergyIqAccessProvider>
          <AccessProbe />
        </EnergyIqAccessProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toBe("ready:preschool-workspace:preschool-demo");
    });
    expect(configApiMock.setWorkspaceId).toHaveBeenCalledWith("preschool-workspace");
  });

  it("advances navigation generation synchronously before React publishes pending state", async () => {
    configApiMock.getEnergyAccessContext.mockResolvedValue(
      accessContext("tuya-office", [project("tuya-office", "tuya-office")]),
    );

    await act(async () => {
      root.render(
        <EnergyIqAccessProvider>
          <NavigationGenerationProbe />
        </EnergyIqAccessProvider>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain("generation:0"));

    const beginButton = container.querySelector<HTMLButtonElement>("button[data-action='begin']")!;
    const finishButton = container.querySelector<HTMLButtonElement>("button[data-action='finish']")!;
    await act(async () => beginButton.click());
    expect(beginButton.getAttribute("data-generation-after-action")).toBe("1");
    await act(async () => finishButton.click());
    expect(finishButton.getAttribute("data-generation-after-action")).toBe("2");
  });
});

function AccessProbe() {
  const { access, activeProject, error, loading } = useEnergyIqAccess();
  if (loading) return <div>loading</div>;
  if (error) return <div>error:{error}</div>;
  return <div>ready:{access?.activeWorkspaceId}:{activeProject?.id}</div>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function ManualWorkspaceSwitchProbe() {
  const { access, activeProject, error, loading, selectOrganisation } = useEnergyIqAccess();
  const [returnedProjectId, setReturnedProjectId] = React.useState<string | null>(null);
  if (loading) return <div>loading</div>;
  if (error) return <div>error:{error}</div>;
  return (
    <div>
      ready:{access?.activeWorkspaceId}:{activeProject?.id}
      {returnedProjectId ? `:return:${returnedProjectId}` : null}
      <button
        type="button"
        onClick={() => {
          void selectOrganisation("tuya-office").then((project) => {
            setReturnedProjectId(project?.id ?? "none");
          });
        }}
      >
        Switch to Tuya Office
      </button>
    </div>
  );
}

function NavigationGenerationProbe() {
  const {
    beginNavigationTransition,
    finishNavigationTransition,
    getNavigationTransitionGeneration,
  } = useEnergyIqAccess();
  return (
    <>
      {([
        ["begin", beginNavigationTransition],
        ["finish", finishNavigationTransition],
      ] as const).map(([action, transition]) => (
        <button
          key={action}
          type="button"
          data-action={action}
          data-generation-after-action={getNavigationTransitionGeneration()}
          onClick={(event) => {
            transition();
            event.currentTarget.setAttribute(
              "data-generation-after-action",
              String(getNavigationTransitionGeneration()),
            );
          }}
        >
          {action}:generation:{getNavigationTransitionGeneration()}
        </button>
      ))}
    </>
  );
}

function accessContext(
  activeWorkspaceId: string,
  projects: EnergyProjectDto[],
): EnergyAccessContextDto {
  return {
    role: "admin",
    user: { id: "charles", displayName: "Charles" },
    activeWorkspaceId,
    workspaces: [
      { id: "tuya-office", name: "Tuya Office", kind: "customer", disabled: false },
      { id: "ngee-ann-workspace", name: "Ngee Ann", kind: "customer", disabled: false },
    ],
    projects,
  };
}

function project(id: string, workspaceId: string): EnergyProjectDto {
  return {
    id,
    workspaceId,
    name: id,
    status: "published",
    timezone: "Asia/Singapore",
  };
}
