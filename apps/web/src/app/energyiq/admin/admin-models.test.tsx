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
    const client = { getReportModels: vi.fn().mockResolvedValue(state), createReportModel: vi.fn(), copyReportModel: vi.fn(),
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
      expect([...div.querySelectorAll("input")].some(input => input.value === "claude-opus-5-5")).toBe(true);
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
  it("copies a saved Claude configuration with a new model ID and the fast setting, without asking for the key", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("React", React);
    const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
    const saved = { id: "a", name: "Claude Opus 5", modelName: "claude-opus-5", baseUrl: "https://api.anthropic.com", apiProtocol: "anthropic-messages" as const, speed: "standard" as const, hasSecret: true, revision: 2, compatible: true, testedAt: null };
    const state = { current: { configured: true, available: true, modelName: "claude-opus-5", revision: 1, sourceProfileId: "a" }, profiles: [saved] };
    const copy = { ...saved, id: "c", name: "Claude Opus 5.5 fast", modelName: "claude-opus-5-5", speed: "fast" as const, revision: 1, compatible: false };
    const client = { getReportModels: vi.fn().mockResolvedValue(state), createReportModel: vi.fn(), copyReportModel: vi.fn().mockResolvedValue(copy),
      testReportModel: vi.fn(), activateReportModel: vi.fn() };
    const button = (name: string) => [...div.querySelectorAll("button")].find(b => b.textContent === name)!;
    const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
      setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    };
    try {
      await act(async () => { root.render(<AdminModels client={client} />); });
      await act(async () => button("Copy with changes").click());
      const form = div.querySelector('form[aria-label="Copy model"]')!;
      expect(form.textContent).toContain("Copy Claude Opus 5");
      expect(form.textContent).toContain("Uses the key saved with Claude Opus 5.");
      expect(form.querySelector('input[type="password"]')).toBeNull();
      expect((form.querySelector('input[type="url"]') as HTMLInputElement).disabled).toBe(true);
      const inputs = [...form.querySelectorAll("input")];
      await act(async () => { setValue(inputs[0]!, "Claude Opus 5.5 fast"); setValue(inputs.find(input => input.value === "claude-opus-5")!, "claude-opus-5-5"); });
      const speed = [...form.querySelectorAll("select")].find(select => [...select.options].some(option => option.value === "fast"))!;
      await act(async () => setValue(speed, "fast"));
      await act(async () => button("Save configuration").click());
      expect(client.copyReportModel).toHaveBeenCalledWith("a", 2, { name: "Claude Opus 5.5 fast", modelName: "claude-opus-5-5", speed: "fast" });
      expect(client.createReportModel).not.toHaveBeenCalled();
      expect(div.textContent).toContain("Anthropic · Fast");
    } finally { await act(async () => root.unmount()); div.remove(); vi.unstubAllGlobals(); }
  });
});

