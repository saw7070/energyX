/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyQueryContextDto } from "../../../lib/config-api";

const navigationMock = vi.hoisted(() => ({
  pathname: "/energyiq/ai",
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

const configApiMock = vi.hoisted(() => ({
  resolveEnergyQueryContext: vi.fn(),
  continueEnergySessionOnCurrent: vi.fn(),
}));

const accessMock = vi.hoisted(() => ({
  activeWorkspaceId: "default",
  activeProjectId: "preschool-demo",
  loading: false,
  navigationTransitionPending: false,
  navigationTransitionGeneration: 0,
  error: null as string | null,
}));

const dataTasksProbeMock = vi.hoisted(() => ({
  onSessionSelectionStarted: undefined as ((sessionId: string) => void) | undefined,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMock.pathname,
  useRouter: () => ({ replace: navigationMock.replace }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock("next/dynamic", async () => {
  const ReactModule = await import("react");
  return {
    default: () => function DataTasksProbe(props: {
      externalContext: {
        from: string;
        workspaceId: string;
        projectId: string;
        forkedFromSessionId?: string;
        forkedFromRunId?: string;
        rangeChangeDisclosure?: string;
        historyStatus?: "outdated" | "historical";
        historicalDataThrough?: string;
      };
      interactionDisabledReason?: string;
      startWithFreshSession?: boolean;
      freshSessionRequestKey?: number;
      serverSessionRequest?: { key: number; session: { id: string; threadId: string } };
      onFreshSessionCreated?: (sessionId: string, origin?: "user" | "request") => void;
      onInitialFreshSessionCreated?: (sessionId: string) => void;
      onSessionSelectionStarted?: (sessionId: string) => void;
      onSessionEnergyContextRestored?: (context: {
        sourceRunId?: string;
        workspaceId: string;
        projectId: string;
        projectName: string;
        scopeId: string;
        scopeName: string;
        scopeType: string;
        resource: "electricity";
        timezone: string;
        from: string;
        to: string;
        hierarchyRevisionId: string;
        meterMappingRevisionId: string;
        meterFormulaRevisionId: string;
        projectReleaseId?: string;
        dataSnapshotId: string;
        forkedFromSessionId?: string;
        forkedFromContextStatus?: "available" | "unavailable";
        forkedFromUnavailableReason?:
          | "source-run-unavailable"
          | "source-context-unavailable";
        forkedFromRunId?: string;
        forkedFromFrom?: string;
        forkedFromTo?: string;
      } | null, sessionId: string, origin: {
        workspaceId: string;
        projectId: string;
      }) => void;
    }) {
      dataTasksProbeMock.onSessionSelectionStarted = props.onSessionSelectionStarted;
      const origin = {
        workspaceId: props.externalContext.workspaceId,
        projectId: props.externalContext.projectId,
      };
      ReactModule.useEffect(() => {
        if (!props.serverSessionRequest) return;
        props.onFreshSessionCreated?.(
          props.serverSessionRequest.session.threadId,
          "request",
        );
        const restored = props.serverSessionRequest.session.threadId === "session-fork-same-url"
          ? sameUrlContinuedSessionResponse().energyContext
          : props.serverSessionRequest.session.threadId === "session-fork-unavailable"
            ? unavailableContinuedSessionResponse().energyContext
            : continuedSessionResponse().energyContext;
        props.onSessionEnergyContextRestored?.({
          ...restored,
        }, props.serverSessionRequest.session.threadId, origin);
      }, [props.serverSessionRequest]);
      return ReactModule.createElement("div", {
        "data-testid": "data-tasks",
        "data-interaction-disabled-reason": props.interactionDisabledReason,
        "data-start-with-fresh-session": String(Boolean(props.startWithFreshSession)),
        "data-fresh-session-request-key": String(props.freshSessionRequestKey ?? 0),
        "data-forked-from-session-id": props.externalContext.forkedFromSessionId,
        "data-range-change-disclosure": props.externalContext.rangeChangeDisclosure,
        "data-history-status": props.externalContext.historyStatus,
        "data-historical-data-through": props.externalContext.historicalDataThrough,
      },
        ReactModule.createElement("span", { "data-testid": "context-from" }, props.externalContext.from),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "new-data-task",
          onClick: () => props.onFreshSessionCreated?.("session-fresh", "user"),
        }, "New data task"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "requested-new-data-task",
          onClick: () => props.onFreshSessionCreated?.("session-fork", "request"),
        }, "Requested new data task"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "initial-fresh-task",
          onClick: () => props.onInitialFreshSessionCreated?.("session-fresh"),
        }, "Initial fresh data task"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-fresh-null",
          onClick: () => props.onSessionEnergyContextRestored?.(null, "session-fresh", origin),
        }, "Restore fresh empty session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-fresh-exact",
          onClick: () => props.onSessionEnergyContextRestored?.(sessionContext(
            "2026-04-30T16:00:00.000Z",
            "2026-06-30T16:00:00.000Z",
          ), "session-fresh", origin),
        }, "Restore completed fresh session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-fresh-null-twice",
          onClick: () => {
            props.onSessionEnergyContextRestored?.(null, "session-fresh", origin);
            props.onSessionEnergyContextRestored?.(null, "session-fresh", origin);
          },
        }, "Replay fresh empty session restore"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-fresh-malformed-then-null",
          onClick: () => {
            props.onSessionEnergyContextRestored?.({
              ...sessionContext(
                "2026-07-24T16:00:00.000Z",
                "2026-08-23T16:00:00.000Z",
              ),
              hierarchyRevisionId: "",
            }, "session-fresh", origin);
            props.onSessionEnergyContextRestored?.(null, "session-fresh", origin);
          },
        }, "Restore malformed then empty fresh session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-fresh-mismatch-then-null",
          onClick: () => {
            props.onSessionEnergyContextRestored?.(sessionContext(
              "2026-07-24T16:00:00.000Z",
              "2026-08-23T16:00:00.000Z",
              { workspaceId: "other-workspace", projectId: "preschool-demo" },
            ), "session-fresh", origin);
            props.onSessionEnergyContextRestored?.(null, "session-fresh", origin);
          },
        }, "Restore mismatched then empty fresh session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-initial",
          onClick: () => props.onSessionEnergyContextRestored?.(sessionContext(
            "2026-07-24T16:00:00.000Z",
            "2026-08-23T16:00:00.000Z",
          ), "session-a", origin),
        }, "Restore initial session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-production-ngee-history",
          onClick: () => props.onSessionEnergyContextRestored?.(sessionContext(
            "2026-05-31T16:00:00.000Z",
            "2026-06-16T16:00:00.000Z",
            { workspaceId: "default", projectId: "ngee-ann-polytechnic" },
          ), "session-ngee-june", origin),
        }, "Restore production Ngee history"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "select-pending",
          onClick: () => props.onSessionSelectionStarted?.("session-b"),
        }, "Start selecting another session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-other",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-b");
            props.onSessionEnergyContextRestored?.(sessionContext(
              "2026-05-31T16:00:00.000Z",
              "2026-06-08T16:00:00.000Z",
            ), "session-b", origin);
          },
        }, "Restore another session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-same",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-b");
            props.onSessionEnergyContextRestored?.(sessionContext(
              "2026-07-24T16:00:00.000Z",
              "2026-08-23T16:00:00.000Z",
            ), "session-b", origin);
          },
        }, "Restore same-window session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-current-data-fork",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-current-fork");
            props.onSessionEnergyContextRestored?.({
              ...sessionContext(
                "2026-04-30T16:00:00.000Z",
                "2026-06-30T16:00:00.000Z",
              ),
              forkedFromSessionId: "session-historical",
              forkedFromRunId: "run-historical",
              forkedFromFrom: "2026-03-31T16:00:00.000Z",
              forkedFromTo: "2026-04-30T16:00:00.000Z",
            }, "session-current-fork", origin);
          },
        }, "Restore current-data fork"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-same-a",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-a");
            props.onSessionEnergyContextRestored?.(sessionContext(
              "2026-07-24T16:00:00.000Z",
              "2026-08-23T16:00:00.000Z",
            ), "session-a", origin);
          },
        }, "Restore first same-window session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-revision-drift",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-b");
            props.onSessionEnergyContextRestored?.({
              ...sessionContext(
                "2026-07-24T16:00:00.000Z",
                "2026-08-23T16:00:00.000Z",
              ),
              meterFormulaRevisionId: "formula-old",
            }, "session-b", origin);
          },
        }, "Restore same-window outdated publication"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-null",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-b");
            props.onSessionEnergyContextRestored?.(null, "session-b", origin);
          },
        }, "Restore contextless session"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-late-old",
          onClick: () => {
            props.onSessionSelectionStarted?.("session-b");
            props.onSessionEnergyContextRestored?.(sessionContext(
              "2026-05-31T16:00:00.000Z",
              "2026-06-08T16:00:00.000Z",
            ), "session-a", origin);
          },
        }, "Receive late old-session context"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-cross-identity-late",
          onClick: () => props.onSessionEnergyContextRestored?.(sessionContext(
            "2026-05-31T16:00:00.000Z",
            "2026-06-08T16:00:00.000Z",
          ), "session-old-workspace", {
            workspaceId: "default",
            projectId: "preschool-demo",
          }),
        }, "Receive old Workspace context"),
        ReactModule.createElement("button", {
          type: "button",
          "data-testid": "restore-current-identity",
          onClick: () => props.onSessionEnergyContextRestored?.(sessionContext(
            "2026-06-30T16:00:00.000Z",
            "2026-07-31T16:00:00.000Z",
            { workspaceId: "future-workspace", projectId: "future-project" },
          ), "session-current-workspace", {
            workspaceId: "future-workspace",
            projectId: "future-project",
          }),
        }, "Restore current Workspace context"),
      );
    },
  };
});

vi.mock("../../../lib/config-api", () => ({
  configApi: {
    resolveEnergyQueryContext: configApiMock.resolveEnergyQueryContext,
    continueEnergySessionOnCurrent: configApiMock.continueEnergySessionOnCurrent,
  },
}));

vi.mock("./energyiq-access", () => ({
  useEnergyIqAccess: () => ({
    access: { activeWorkspaceId: accessMock.activeWorkspaceId },
    activeProject: {
      id: accessMock.activeProjectId,
      name: "Preschool",
      timezone: "Asia/Singapore",
    },
    loading: accessMock.loading,
    navigationTransitionPending: accessMock.navigationTransitionPending,
    getNavigationTransitionGeneration: () => accessMock.navigationTransitionGeneration,
    error: accessMock.error,
  }),
}));

import { EnergyAnalysisWorkbench } from "./energy-analysis-workbench";

describe("EnergyAnalysisWorkbench fresh task context transition", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    navigationMock.replace.mockReset();
    configApiMock.resolveEnergyQueryContext.mockReset();
    configApiMock.continueEnergySessionOnCurrent.mockReset();
    configApiMock.continueEnergySessionOnCurrent.mockResolvedValue(continuedSessionResponse());
    dataTasksProbeMock.onSessionSelectionStarted = undefined;
    accessMock.activeWorkspaceId = "default";
    accessMock.activeProjectId = "preschool-demo";
    accessMock.loading = false;
    accessMock.navigationTransitionPending = false;
    accessMock.navigationTransitionGeneration = 0;
    accessMock.error = null;
    navigationMock.searchParams = new URLSearchParams({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      period: "Custom",
      from: "2026-07-24T16:00:00.000Z",
      to: "2026-08-23T16:00:00.000Z",
      dataSnapshotId: "snapshot:2026-07-24T16:00:00.000Z",
      projectReleaseId: "release-1",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("withdraws the historical external context until all-available resolution completes", async () => {
    const nextContext = deferred<EnergyQueryContextDto>();
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"))
      .mockReturnValueOnce(nextContext.promise);

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="context-from"]')?.textContent)
        .toBe("2026-07-24T16:00:00.000Z");
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(navigationMock.replace).toHaveBeenCalledWith(
      "/energyiq/ai?projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
      { scroll: false },
    );
    const transitioningDataTasks = container.querySelector('[data-testid="data-tasks"]');
    expect(transitioningDataTasks).not.toBeNull();
    expect(transitioningDataTasks?.closest("[inert]")).not.toBeNull();
    expect(container.textContent).toContain("Resolving project, scope and reporting period");

    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();

    await act(async () => {
      nextContext.resolve(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"));
      await nextContext.promise;
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="context-from"]')?.textContent)
        .toBe("2026-04-30T16:00:00.000Z");
    });
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).toBeNull();
  });

  it("re-resolves a fresh Session even when the URL already requests all-available", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    const nextContext = deferred<EnergyQueryContextDto>();
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"))
      .mockReturnValueOnce(nextContext.promise);

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="context-from"]')?.textContent)
        .toBe("2026-04-30T16:00:00.000Z");
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="new-data-task"]')?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-fresh-null"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();

    await act(async () => {
      nextContext.resolve(context("2026-03-31T16:00:00.000Z", "2026-07-31T16:00:00.000Z"));
      await nextContext.promise;
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="context-from"]')?.textContent)
        .toBe("2026-03-31T16:00:00.000Z");
    });
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).toBeNull();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason")).toBeNull();
  });

  it.each([
    "restore-fresh-malformed-then-null",
    "restore-fresh-mismatch-then-null",
  ])("does not let a later null revive a fresh Session after %s", async (restoreAction) => {
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"))
      .mockResolvedValueOnce(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="new-data-task"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="new-data-task"]')?.click();
    });
    await vi.waitFor(() => expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(2));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${restoreAction}"]`)?.click();
    });

    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason"))
      .toContain("exact analysis context is unavailable");
  });

  it("keeps a direct top-nav fresh Session interactive when its missing history is reported twice", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-05-31T16:00:00.000Z", "2026-06-30T16:00:00.000Z"))
      .mockResolvedValueOnce(context("2026-05-31T16:00:00.000Z", "2026-06-30T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="new-data-task"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="new-data-task"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-fresh-null-twice"]')?.click();
    });

    const dataTasks = container.querySelector('[data-testid="data-tasks"]');
    expect(dataTasks?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector('[data-testid="context-from"]')?.textContent)
      .toBe("2026-05-31T16:00:00.000Z");
  });

  it.each([
    { creationAction: "new-data-task", afterCreationCalls: 2, afterRouteCalls: 3 },
    { creationAction: "initial-fresh-task", afterCreationCalls: 1, afterRouteCalls: 2 },
  ])("keeps a direct top-nav fresh Session created via $creationAction interactive after its first exact Run context is persisted", async ({
    creationAction,
    afterCreationCalls,
    afterRouteCalls,
  }) => {
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"))
      .mockResolvedValueOnce(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"))
      .mockResolvedValueOnce(context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="new-data-task"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${creationAction}"]`)?.click();
    });
    await vi.waitFor(() => expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(afterCreationCalls));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-fresh-exact"]')?.click();
    });

    expect(navigationMock.replace).toHaveBeenCalledWith(
      "/energyiq/ai?projectId=preschool-demo&scopeId=preschool-project&resource=electricity&period=Custom&from=2026-04-30T16%3A00%3A00.000Z&to=2026-06-30T16%3A00%3A00.000Z&dataSnapshotId=snapshot%3A2026-04-30T16%3A00%3A00.000Z&projectReleaseId=release-1",
      { scroll: false },
    );
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();

    navigationMock.searchParams = new URLSearchParams({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      period: "Custom",
      from: "2026-04-30T16:00:00.000Z",
      to: "2026-06-30T16:00:00.000Z",
      dataSnapshotId: "snapshot:2026-04-30T16:00:00.000Z",
      projectReleaseId: "release-1",
    });
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(afterRouteCalls));
    await vi.waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());

    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason")).toBeNull();
  });

  it("restores a different exact Session inertly, then enables follow-up after server resolution", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"))
      .mockResolvedValueOnce(context("2026-05-31T16:00:00.000Z", "2026-06-08T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-other"]')?.click();
    });

    expect(navigationMock.replace).toHaveBeenCalledWith(
      "/energyiq/ai?projectId=preschool-demo&scopeId=preschool-project&resource=electricity&period=Custom&from=2026-05-31T16%3A00%3A00.000Z&to=2026-06-08T16%3A00%3A00.000Z&dataSnapshotId=snapshot%3A2026-05-31T16%3A00%3A00.000Z&projectReleaseId=release-1",
      { scroll: false },
    );
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();

    navigationMock.searchParams = new URLSearchParams({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-31T16:00:00.000Z",
      to: "2026-06-08T16:00:00.000Z",
      dataSnapshotId: "snapshot:2026-05-31T16:00:00.000Z",
      projectReleaseId: "release-1",
    });
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());

    expect(container.querySelector('[data-testid="context-from"]')?.textContent)
      .toBe("2026-05-31T16:00:00.000Z");
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason")).toBeNull();
  });

  it("starts direct Ngee all-available fresh instead of restoring the production June Session", async () => {
    accessMock.activeProjectId = "ngee-ann-polytechnic";
    navigationMock.searchParams = new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=project&resource=electricity",
    );
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context(
        "2026-04-30T16:00:00.000Z",
        "2026-08-19T16:00:00.000Z",
        { workspaceId: "default", projectId: "ngee-ann-polytechnic" },
      ));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="restore-initial"]')).not.toBeNull());
    const freshSession = container.querySelector('[data-testid="data-tasks"]');
    expect(freshSession?.getAttribute("data-start-with-fresh-session")).toBe("true");
    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="context-from"]')?.textContent)
      .toBe("2026-04-30T16:00:00.000Z");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-production-ngee-history"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="context-from"]')?.textContent)
      .toBe("2026-04-30T16:00:00.000Z");
  });

  it("makes the old Session inert as soon as another Session is selected", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="select-pending"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();
  });

  it("keeps a selected exact Session writable when it restores the same URL window", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-same"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).toBeNull();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-history-status")).toBe("historical");
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-historical-data-through")).toBe("2026-08-23");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("keeps a completed exact Session writable after switching away and back", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="restore-same-a"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-same-a"]')?.click();
      container.querySelector<HTMLButtonElement>('[data-testid="restore-same"]')?.click();
      container.querySelector<HTMLButtonElement>('[data-testid="restore-same-a"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("cold-loads an existing exact Session writable when its server context resolves", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="restore-initial"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("keeps a same-Snapshot Session read-only when its published revisions drift", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-revision-drift"]')?.click();
    });

    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason"))
      .toContain("older version of the facility details");
  });

  it("keeps a contextless historical Session visible and offers an explicit current-data continuation", async () => {
    configApiMock.continueEnergySessionOnCurrent.mockResolvedValueOnce(
      unavailableContinuedSessionResponse(),
    );
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-null"]')?.click();
    });

    const dataTasks = container.querySelector('[data-testid="data-tasks"]');
    expect(dataTasks).not.toBeNull();
    expect(dataTasks?.closest("[inert]")).toBeNull();
    expect(dataTasks?.getAttribute("data-interaction-disabled-reason")).toContain("exact analysis context is unavailable");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    const continueButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="continue-on-current-data"]',
    );
    expect(continueButton).not.toBeNull();
    await act(async () => continueButton?.click());
    expect(configApiMock.continueEnergySessionOnCurrent).toHaveBeenCalledWith({
      sourceSessionId: "session-b",
      target: {
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        resource: "electricity",
      },
    });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-range-change-disclosure"))
      .toContain("exact source context is unavailable"));
  });

  it("ignores a late restore callback from the previously selected Session", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-late-old"]')?.click();
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();
  });

  it("ignores a cross-identity late callback without claiming the new Workspace Session", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"))
      .mockResolvedValueOnce(context(
        "2026-06-30T16:00:00.000Z",
        "2026-07-31T16:00:00.000Z",
        { workspaceId: "future-workspace", projectId: "future-project" },
      ));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());

    navigationMock.searchParams = new URLSearchParams(
      "projectId=future-project&scopeId=preschool-project&resource=electricity",
    );
    accessMock.activeWorkspaceId = "future-workspace";
    accessMock.activeProjectId = "future-project";
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(2));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-cross-identity-late"]')?.click();
    });
    expect(navigationMock.replace).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-current-identity"]')?.click();
    });
    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-start-with-fresh-session")).toBe("true");
  });

  it("keeps the old Project context inert while a switched Project resolves", async () => {
    const nextContext = deferred<EnergyQueryContextDto>();
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"))
      .mockReturnValueOnce(nextContext.promise);

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());

    accessMock.activeProjectId = "future-project";
    await act(async () => root.render(<EnergyAnalysisWorkbench />));

    const oldProjectTasks = container.querySelector('[data-testid="data-tasks"]');
    expect(oldProjectTasks).not.toBeNull();
    expect(oldProjectTasks?.closest("[inert]")).not.toBeNull();
  });

  it("becomes inert at Workspace selection start and stays honestly unavailable after access fails", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());

    accessMock.loading = true;
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-other"]')?.click();
    });
    expect(navigationMock.replace).not.toHaveBeenCalled();

    accessMock.loading = false;
    accessMock.error = "NETWORK_TIMEOUT";
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    expect(container.textContent).toContain("Analysis context is unavailable");
    expect(container.textContent).toContain("NETWORK_TIMEOUT");
    expect(container.querySelector('[data-testid="data-tasks"]')).toBeNull();
  });

  it("shows honest unavailable instead of restoring stale interaction after resolution fails", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockResolvedValueOnce(context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"))
      .mockRejectedValueOnce(new Error("ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    await act(async () => root.render(<EnergyAnalysisWorkbench />));

    await vi.waitFor(() => expect(container.textContent).toContain("Analysis context is unavailable"));
    expect(container.textContent).toContain("ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE");
    expect(container.querySelector('[data-testid="data-tasks"]')).toBeNull();
  });

  it("cold-loads an unresolvable exact historical URL with its Session surface read-only", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));

    const historicalSession = await vi.waitFor(() => {
      const session = container.querySelector('[data-testid="data-tasks"]');
      expect(session).not.toBeNull();
      return session;
    });
    expect(historicalSession?.getAttribute("data-interaction-disabled-reason"))
      .toContain("historical exact analysis context is unavailable");
    expect(container.textContent).toContain("2026-07-24T16:00:00.000Z");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });
    expect(container.querySelector('[data-testid="context-from"]')?.textContent)
      .toBe("2026-07-24T16:00:00.000Z");
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-interaction-disabled-reason"))
      .toContain("historical exact analysis context is unavailable");
  });

  it("forks an unavailable historical Session onto server-owned current data with explicit lineage", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"))
      .mockResolvedValue(context(
        "2026-04-30T16:00:00.000Z",
        "2026-06-30T16:00:00.000Z",
      ));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });

    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });
    await act(async () => continueButton.click());

    expect(configApiMock.continueEnergySessionOnCurrent).toHaveBeenCalledWith({
      sourceSessionId: "session-a",
      target: {
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        resource: "electricity",
      },
    });
    expect(configApiMock.resolveEnergyQueryContext).toHaveBeenCalledTimes(1);

    expect(navigationMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("period=Custom"),
      { scroll: false },
    );
    navigationMock.searchParams = new URLSearchParams({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      period: "Custom",
      from: "2026-04-30T16:00:00.000Z",
      to: "2026-06-30T16:00:00.000Z",
      dataSnapshotId: "snapshot:2026-04-30T16:00:00.000Z",
      projectReleaseId: "release-1",
    });
    await act(async () => root.render(<EnergyAnalysisWorkbench />));

    await vi.waitFor(() => {
      const dataTasks = container.querySelector('[data-testid="data-tasks"]');
      expect(dataTasks?.getAttribute("data-forked-from-session-id")).toBe("session-a");
      expect(dataTasks?.getAttribute("data-range-change-disclosure"))
        .toContain("2026-07-25 to 2026-08-23");
      expect(dataTasks?.getAttribute("data-range-change-disclosure"))
        .toContain("2026-05-01 to 2026-06-30");
      expect(dataTasks?.getAttribute("data-fresh-session-request-key")).toBe("0");
      expect(dataTasks?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    });
  });

  it("keeps the historical Session inert until the server-created current Session is ready", async () => {
    const pending = deferred<ReturnType<typeof continuedSessionResponse>>();
    configApiMock.continueEnergySessionOnCurrent.mockReturnValueOnce(pending.promise);
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });
    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });

    await act(async () => continueButton.click());
    expect(configApiMock.continueEnergySessionOnCurrent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();

    await act(async () => pending.resolve(continuedSessionResponse()));
    expect(navigationMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("dataSnapshotId=snapshot%3A2026-04-30T16%3A00%3A00.000Z"),
      { scroll: false },
    );
  });

  it("ignores a pending current-data fork after another Session selection starts", async () => {
    const pending = deferred<ReturnType<typeof continuedSessionResponse>>();
    configApiMock.continueEnergySessionOnCurrent.mockReturnValueOnce(pending.promise);
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="restore-initial"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });
    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });
    await act(async () => continueButton.click());

    await act(async () => {
      dataTasksProbeMock.onSessionSelectionStarted?.("session-b");
      pending.resolve(continuedSessionResponse());
      await pending.promise;
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="data-tasks"]')?.closest("[inert]")).not.toBeNull();
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-forked-from-session-id") ?? null).toBeNull();
  });

  it("ignores a pending current-data fork as soon as navigation starts", async () => {
    const pending = deferred<ReturnType<typeof continuedSessionResponse>>();
    configApiMock.continueEnergySessionOnCurrent.mockReturnValueOnce(pending.promise);
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="restore-initial"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });
    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });
    await act(async () => continueButton.click());

    accessMock.navigationTransitionGeneration += 1;
    accessMock.navigationTransitionPending = true;
    await act(async () => {
      pending.resolve(continuedSessionResponse());
      await pending.promise;
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-forked-from-session-id") ?? null).toBeNull();
  });

  it("does not apply a pending current-data fork after the Workbench unmounts", async () => {
    const pending = deferred<ReturnType<typeof continuedSessionResponse>>();
    configApiMock.continueEnergySessionOnCurrent.mockReturnValueOnce(pending.promise);
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="restore-initial"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });
    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });
    await act(async () => continueButton.click());

    await act(async () => root.unmount());
    await act(async () => {
      pending.resolve(continuedSessionResponse());
      await pending.promise;
    });

    expect(navigationMock.replace).not.toHaveBeenCalled();
  });

  it("activates the server-created current Session when only hidden revision pins changed", async () => {
    configApiMock.resolveEnergyQueryContext.mockResolvedValue(
      context("2026-07-24T16:00:00.000Z", "2026-08-23T16:00:00.000Z"),
    );
    configApiMock.continueEnergySessionOnCurrent.mockResolvedValueOnce(
      sameUrlContinuedSessionResponse(),
    );

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-revision-drift"]')?.click();
    });
    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });

    await act(async () => continueButton.click());

    await vi.waitFor(() => {
      const dataTasks = container.querySelector('[data-testid="data-tasks"]');
      expect(dataTasks?.getAttribute("data-forked-from-session-id")).toBe("session-b");
      expect(dataTasks?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    });
    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("ENERGYIQ_SESSION_FORK_CURRENT_CONTEXT_NOT_CHANGED");
  });

  it("does not leak current-data fork lineage into a later user-created Session", async () => {
    configApiMock.resolveEnergyQueryContext
      .mockRejectedValueOnce(new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH"))
      .mockResolvedValue(context(
        "2026-04-30T16:00:00.000Z",
        "2026-06-30T16:00:00.000Z",
      ));

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-initial"]')?.click();
    });
    const continueButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="continue-on-current-data"]');
      expect(button).not.toBeNull();
      return button!;
    });
    await act(async () => continueButton.click());
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="data-forked-from-session-id"]')).toBeNull();
      expect(container.querySelector('[data-testid="data-tasks"]')
        ?.getAttribute("data-forked-from-session-id")).toBe("session-a");
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="requested-new-data-task"]')?.click();
    });
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-forked-from-session-id")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="new-data-task"]')?.click();
    });
    expect(container.querySelector('[data-testid="data-tasks"]')
      ?.getAttribute("data-forked-from-session-id")).toBeNull();
  });

  it("restores a persisted current-data fork writable with its range-change disclosure", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "projectId=preschool-demo&scopeId=preschool-project&resource=electricity",
    );
    configApiMock.resolveEnergyQueryContext.mockResolvedValue(
      context("2026-04-30T16:00:00.000Z", "2026-06-30T16:00:00.000Z"),
    );

    await act(async () => root.render(<EnergyAnalysisWorkbench />));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-tasks"]')).not.toBeNull());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="restore-current-data-fork"]')?.click();
    });

    navigationMock.searchParams = new URLSearchParams({
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      resource: "electricity",
      period: "Custom",
      from: "2026-04-30T16:00:00.000Z",
      to: "2026-06-30T16:00:00.000Z",
      dataSnapshotId: "snapshot:2026-04-30T16:00:00.000Z",
      projectReleaseId: "release-1",
    });
    await act(async () => root.render(<EnergyAnalysisWorkbench />));

    await vi.waitFor(() => {
      const dataTasks = container.querySelector('[data-testid="data-tasks"]');
      expect(dataTasks?.getAttribute("data-forked-from-session-id")).toBe("session-historical");
      expect(dataTasks?.getAttribute("data-range-change-disclosure"))
        .toContain("2026-04-01 to 2026-04-30");
      expect(dataTasks?.getAttribute("data-interaction-disabled-reason")).toBeNull();
    });
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const context = (
  from: string,
  to: string,
  identity: { workspaceId: string; projectId: string } = {
    workspaceId: "default",
    projectId: "preschool-demo",
  },
): EnergyQueryContextDto => ({
  userId: "user-1",
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  projectName: "Preschool",
  scopeId: "preschool-project",
  scopeName: "Preschool Portfolio",
  scopeType: "project",
  resource: "electricity",
  timezone: "Asia/Singapore",
  from,
  to,
  endExclusive: true,
  period: "Custom",
  hierarchyRevisionId: "hierarchy-1",
  meterMappingRevisionId: "mapping-1",
  meterFormulaRevisionId: "formula-1",
  dataSnapshotId: `snapshot:${from}`,
  metricVersion: "metric-1",
  businessCalendarVersion: "calendar-1",
  tariffScheduleVersion: "tariff-1",
  projectReleaseId: "release-1",
  resolvedAt: "2026-08-25T00:00:00.000Z",
});

const sessionContext = (
  from: string,
  to: string,
  identity: { workspaceId: string; projectId: string } = {
    workspaceId: "default",
    projectId: "preschool-demo",
  },
) => ({
  sourceRunId: `run:${from}`,
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  projectName: "Preschool",
  scopeId: "preschool-project",
  scopeName: "Preschool Portfolio",
  scopeType: "project",
  resource: "electricity" as const,
  timezone: "Asia/Singapore",
  from,
  to,
  hierarchyRevisionId: "hierarchy-1",
  meterMappingRevisionId: "mapping-1",
  meterFormulaRevisionId: "formula-1",
  projectReleaseId: "release-1",
  dataSnapshotId: `snapshot:${from}`,
});

const continuedSessionResponse = () => {
  const { sourceRunId: _sourceRunId, ...persistedContext } = sessionContext(
    "2026-04-30T16:00:00.000Z",
    "2026-06-30T16:00:00.000Z",
  );
  return {
    session: {
      id: "session-fork",
      threadId: "session-fork",
      workspaceId: "default",
      projectId: "preschool-demo",
      title: "New data task",
    },
    energyContext: {
      ...persistedContext,
      forkedFromSessionId: "session-a",
      forkedFromContextStatus: "available" as const,
      forkedFromRunId: "run:2026-07-24T16:00:00.000Z",
      forkedFromFrom: "2026-07-24T16:00:00.000Z",
      forkedFromTo: "2026-08-23T16:00:00.000Z",
    },
  };
};

const sameUrlContinuedSessionResponse = () => {
  const { sourceRunId: _sourceRunId, ...persistedContext } = sessionContext(
    "2026-07-24T16:00:00.000Z",
    "2026-08-23T16:00:00.000Z",
  );
  return {
    session: {
      id: "session-fork-same-url",
      threadId: "session-fork-same-url",
      workspaceId: "default",
      projectId: "preschool-demo",
      title: "New data task",
    },
    energyContext: {
      ...persistedContext,
      forkedFromSessionId: "session-b",
      forkedFromContextStatus: "available" as const,
      forkedFromRunId: "run:2026-07-24T16:00:00.000Z",
      forkedFromFrom: "2026-07-24T16:00:00.000Z",
      forkedFromTo: "2026-08-23T16:00:00.000Z",
    },
  };
};

const unavailableContinuedSessionResponse = () => {
  const { sourceRunId: _sourceRunId, ...persistedContext } = sessionContext(
    "2026-04-30T16:00:00.000Z",
    "2026-06-30T16:00:00.000Z",
  );
  return {
    session: {
      id: "session-fork-unavailable",
      threadId: "session-fork-unavailable",
      workspaceId: "default",
      projectId: "preschool-demo",
      title: "New data task",
    },
    energyContext: {
      ...persistedContext,
      forkedFromSessionId: "session-b",
      forkedFromContextStatus: "unavailable" as const,
      forkedFromUnavailableReason: "source-run-unavailable" as const,
    },
  };
};
