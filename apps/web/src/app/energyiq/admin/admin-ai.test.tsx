/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configApi, type EnergyAdminAiDto } from "../../../lib/config-api";
import { AiAnswerNote } from "../_components/ai-answer-note";
import { AdminAiGovernance } from "./admin-ai";

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const render = async (node: React.ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
};

const data = (enabled: boolean, limit?: number): EnergyAdminAiDto => ({
  monthStart: "2026-10-01T00:00:00.000Z",
  platformModel: "DeepSeek (deepseek-chat)",
  models: [{ id: "model-qwen", name: "Qwen SG", modelName: "qwen-plus", host: "dashscope-intl.aliyuncs.com", label: "Qwen SG (qwen-plus)" }],
  organisations: [{
    id: "client-a", name: "Acme Holdings", disabled: false,
    settings: { workspaceId: "client-a", enabled, ...(limit !== undefined ? { monthlyRequestLimit: limit } : {}) },
    usage: { requests: 45, blocked: 2, inputTokens: 90_000, outputTokens: 12_000, byFeature: { advisor: 40, overview: 5 }, helpful: 7, notHelpful: 1 },
  }],
});

it("lets a super admin switch a client's AI, choose its model and set a monthly limit", async () => {
  vi.spyOn(configApi, "getEnergyAdminAi").mockResolvedValue(data(true, 50));
  const update = vi.spyOn(configApi, "updateEnergyAdminAi").mockImplementation(async (_id, body) => data(body.enabled ?? true, body.monthlyRequestLimit ?? 50));
  const { host, root } = await render(<AdminAiGovernance />);
  expect(host.textContent).toContain("Acme Holdings");
  expect(host.textContent).toContain("45 / 50 requests");
  expect(host.textContent).toContain("102,000 tokens · 2 refused");
  expect(host.textContent).toContain("DeepSeek (deepseek-chat)");

  await act(async () => (host.querySelector('button[role="switch"]') as HTMLButtonElement).click());
  expect(update).toHaveBeenCalledWith("client-a", { enabled: false });
  expect(host.textContent).toContain("Acme Holdings: AI switched off.");

  const select = host.querySelector('select[aria-label="Model for Acme Holdings"]') as HTMLSelectElement;
  await act(async () => { select.value = "model-qwen"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(update).toHaveBeenLastCalledWith("client-a", { modelProfileId: "model-qwen" });

  const input = host.querySelector('input[aria-label="Monthly AI request limit for Acme Holdings"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, "200"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Save") as HTMLButtonElement).click());
  expect(update).toHaveBeenLastCalledWith("client-a", { monthlyRequestLimit: 200 });
  await act(async () => root.unmount());
});

it("marks AI answers and records a helpful / not helpful rating with an optional note", async () => {
  vi.spyOn(configApi, "getAiFeedback").mockResolvedValue({});
  const send = vi.spyOn(configApi, "sendAiFeedback").mockResolvedValue({ rating: "down" });
  const { host, root } = await render(<AiAnswerNote targetKind="advisor" targetId="run-1" projectId="site-1" />);
  expect(host.textContent).toContain("AI-generated");
  expect(host.querySelector('a[href="/legal/ai-use"]')).not.toBeNull();
  await act(async () => (host.querySelector('button[aria-label="Not helpful"]') as HTMLButtonElement).click());
  expect(send).toHaveBeenCalledWith({ targetKind: "advisor", targetId: "run-1", rating: "down", projectId: "site-1" });
  const note = host.querySelector('input[aria-label="What was wrong? (optional)"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(note, "Used last year's rate"); note.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => (host.querySelector("form button") as HTMLButtonElement).click());
  expect(send).toHaveBeenLastCalledWith({ targetKind: "advisor", targetId: "run-1", rating: "down", projectId: "site-1", comment: "Used last year's rate" });
  expect(host.textContent).toContain("Thanks for the feedback.");
  expect(host.querySelector('button[aria-label="Not helpful"]')!.getAttribute("aria-pressed")).toBe("true");
  await act(async () => root.unmount());
});
