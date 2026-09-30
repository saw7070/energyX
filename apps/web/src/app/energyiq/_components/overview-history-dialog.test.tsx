/** @vitest-environment happy-dom */

import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OverviewHistoryDialog } from "./overview-history-dialog";

vi.mock("./saved-analysis-history", () => ({
  SavedAnalysisHistory: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect("saved-2")}>Open saved 2</button>
  ),
}));

vi.mock("./saved-analysis-detail", () => ({
  SavedAnalysisDetail: ({ analysisId, onBack }: { analysisId: string; onBack: () => void }) => (
    <div><span>Saved report {analysisId}</span><button type="button" onClick={onBack}>Back to history</button></div>
  ),
}));

describe("OverviewHistoryDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll("[data-energyiq-history-overlay='true']").forEach((node) => node.remove());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens as a centered modal, keeps keyboard focus inside and closes details with Escape", async () => {
    const onSelect = vi.fn<(id: string) => void>();
    const onClose = vi.fn<() => void>();
    const onBack = vi.fn<() => void>();

    await act(async () => {
      root.render(
        <OverviewHistoryDialog
          projectName="Preschool Demo"
          selectedAnalysisId={null}
          onSelect={onSelect}
          onBackToHistory={onBack}
          onClose={onClose}
          returnFocusRef={createRef<HTMLButtonElement>()}
        />,
      );
    });

    const dialog = document.querySelector<HTMLElement>("[data-energyiq-history-dialog='true']");
    const open = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Open saved 2");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    await act(async () => open?.click());
    expect(onSelect).toHaveBeenCalledWith("saved-2");

    await act(async () => {
      root.render(
        <OverviewHistoryDialog
          projectName="Preschool Demo"
          selectedAnalysisId="saved-2"
          onSelect={onSelect}
          onBackToHistory={onBack}
          onClose={onClose}
          returnFocusRef={createRef<HTMLButtonElement>()}
        />,
      );
    });

    expect(document.body.textContent).toContain("Saved report saved-2");
    document.body.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe("Close");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
