/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const restoreMock = vi.hoisted(() => ({
  getSessionConversation: vi.fn(),
  markThreadRestored: vi.fn(),
  setThreadRestoring: vi.fn(),
  threadId: "session-missing",
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({
    agent: { isRunning: false, messages: [], setMessages: vi.fn() },
  }),
  useCopilotChatConfiguration: () => ({ threadId: restoreMock.threadId }),
}));

vi.mock("../../../lib/config-api/client", () => ({
  configApi: { getSessionConversation: restoreMock.getSessionConversation },
}));

vi.mock("../../../lib/config-api/capabilities", () => ({
  getRuntimeCapabilities: () => ({ conversationMemory: true }),
}));

vi.mock("../conversation-restore", () => ({
  collaborationResponsesFromConversation: vi.fn(),
  conversationToAgentMessages: vi.fn(),
  hydrateLiveRunFromConversation: vi.fn(),
  hydratePendingInteractionLiveRun: vi.fn(),
  hydrateSessionUsageFromConversation: vi.fn(),
  isIgnorableConversationRestoreError: () => true,
  isConversationRestoreRunActive: () => false,
  latestUserQuestionFromConversation: vi.fn(),
  pendingInteractionsFromConversation: vi.fn(),
  shouldKeepConversationMessageReplacementGrant: () => false,
  shouldRestoreConversationMessages: () => false,
}));

vi.mock("../collaboration-recap", () => ({
  reconcileSuspendedLiveRunState: vi.fn(),
}));

vi.mock("../components/chat/collaboration-responses", () => ({
  getCollaborationResponsesForThread: () => [],
  hydrateCollaborationResponses: vi.fn(),
}));

vi.mock("../components/chat/restored-interrupts", () => ({
  clearRestoredInterrupts: vi.fn(),
  hydrateRestoredInterrupts: vi.fn(),
}));

vi.mock("../components/chat/pending-collaboration-interrupt", () => ({
  clearPendingCollaborationInterrupt: vi.fn(),
}));

vi.mock("../use-data-foundry-run", () => ({
  useConversationRestoreGate: () => ({
    markThreadRestored: restoreMock.markThreadRestored,
    setThreadRestoring: restoreMock.setThreadRestoring,
  }),
  useLiveRun: () => ({ liveRun: { runStatus: "idle" } }),
  useLiveRunSetters: () => ({
    setLatestQuestionForThread: vi.fn(),
    setLiveRunForThread: vi.fn(),
    setSessionUsageForThread: vi.fn(),
  }),
}));

vi.mock("../conversation-branch-store", () => ({
  clearConversationBranchSnapshot: vi.fn(),
  setConversationBranchSnapshot: vi.fn(),
}));

import { SessionConversationRestore } from "../components/chat/SessionConversationRestore";

describe("SessionConversationRestore terminal context binding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    restoreMock.getSessionConversation.mockReset();
    restoreMock.markThreadRestored.mockReset();
    restoreMock.setThreadRestoring.mockReset();
    restoreMock.threadId = "session-missing";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("reports an honest null context when the selected Session is not found", async () => {
    restoreMock.getSessionConversation.mockRejectedValueOnce(new Error("RESOURCE_NOT_FOUND"));
    const onEnergyContextRestored = vi.fn();

    await act(async () => {
      root.render(
        <SessionConversationRestore
          agentId="session:session-missing"
          capabilitiesReady
          isActive
          onEnergyContextRestored={onEnergyContextRestored}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(restoreMock.getSessionConversation).toHaveBeenCalledWith("session-missing");
      expect(restoreMock.markThreadRestored).toHaveBeenCalledWith("session-missing");
    });
    expect(onEnergyContextRestored).toHaveBeenCalledWith(null, "session-missing");
    expect(restoreMock.setThreadRestoring).toHaveBeenLastCalledWith("session-missing", false);
  });

  it("ignores a rejection from a superseded Session restore", async () => {
    const stale = deferred<never>();
    restoreMock.getSessionConversation
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ energyContext: exactEnergyContext("session-current") });
    const onEnergyContextRestored = vi.fn();

    await act(async () => {
      root.render(
        <SessionConversationRestore
          agentId="session:session-stale"
          capabilitiesReady
          isActive
          onEnergyContextRestored={onEnergyContextRestored}
        />,
      );
    });
    await vi.waitFor(() => expect(restoreMock.getSessionConversation).toHaveBeenCalledWith("session-missing"));

    restoreMock.threadId = "session-current";
    await act(async () => {
      root.render(
        <SessionConversationRestore
          agentId="session:session-current"
          capabilitiesReady
          isActive
          onEnergyContextRestored={onEnergyContextRestored}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(onEnergyContextRestored).toHaveBeenCalledWith(
        exactEnergyContext("session-current"),
        "session-current",
      );
    });

    await act(async () => {
      stale.reject(new Error("RESOURCE_NOT_FOUND"));
      await stale.promise.catch(() => undefined);
    });

    expect(onEnergyContextRestored).not.toHaveBeenCalledWith(null, "session-missing");
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const exactEnergyContext = (sourceRunId: string) => ({
  sourceRunId,
  workspaceId: "default",
  projectId: "preschool-demo",
  projectName: "Preschool",
  scopeId: "preschool-project",
  scopeName: "Preschool Portfolio",
  scopeType: "project",
  resource: "electricity" as const,
  timezone: "Asia/Singapore",
  from: "2026-07-24T16:00:00.000Z",
  to: "2026-08-23T16:00:00.000Z",
  hierarchyRevisionId: "hierarchy-1",
  meterMappingRevisionId: "mapping-1",
  meterFormulaRevisionId: "formula-1",
  projectReleaseId: "release-1",
  dataSnapshotId: "snapshot-1",
});
