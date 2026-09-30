/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { AdminModels } from "./admin-models";

describe("Admin Models", () => {
  it("shows the actual model and requires confirmation before changing the shared binding", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("React", React);
    const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
    const candidate = { id: "b", name: "Candidate", modelName: "model-b", baseUrl: "https://api.test/v1", hasSecret: true, revision: 2, compatible: false, testedAt: null };
    const state = { current: { configured: true, available: true, modelName: "model-a", revision: 3, sourceProfileId: "a" }, profiles: [candidate] };
    const client = { getReportModels: vi.fn().mockResolvedValue(state), createReportModel: vi.fn(),
      testReportModel: vi.fn().mockResolvedValue({ ...candidate, revision: 3, compatible: true }),
      activateReportModel: vi.fn().mockResolvedValue({ ...state, current: { ...state.current, modelName: "model-b", sourceProfileId: "b", revision: 4 } }) };
    const button = (name: string) => [...div.querySelectorAll("button")].find(b => b.textContent === name)!;
    try {
      await act(async () => { root.render(<AdminModels client={client} />); });
      expect(div.textContent).toContain("model-a");
      await act(async () => button("Add model").click());
      const protocol = div.querySelector("select")!;
      await act(async () => { protocol.value = "anthropic-messages"; protocol.dispatchEvent(new Event("change", { bubbles: true })); });
      expect([...div.querySelectorAll("input")].some(input => input.value === "https://api.anthropic.com")).toBe(true);
      expect([...div.querySelectorAll("input")].some(input => input.value === "claude-opus-4-8")).toBe(true);
      await act(async () => button("Cancel").click());
      expect(button("Use this model").disabled).toBe(true);
      await act(async () => button("Test connection").click());
      expect(client.activateReportModel).not.toHaveBeenCalled();
      expect(button("Use this model").disabled).toBe(false);
      await act(async () => button("Use this model").click());
      expect(div.textContent).toContain("Switch all projects");
      expect(client.activateReportModel).not.toHaveBeenCalled();
      await act(async () => button("Confirm switch").click());
      expect(client.activateReportModel).toHaveBeenCalledWith("b", 3, 3);
      expect(div.querySelector('[aria-label="Current model"]')?.textContent).toContain("model-b");
    } finally { await act(async () => root.unmount()); div.remove(); vi.unstubAllGlobals(); }
  });
});

