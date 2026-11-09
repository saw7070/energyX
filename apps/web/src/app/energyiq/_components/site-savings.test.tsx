/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EnergySavingsChecksDto } from "../../../lib/config-api";
import { SiteSavingsView } from "./site-savings";

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const carbon = { basis: "grid" as const, grid: "SG" as const, kgCo2ePerKwh: 0.402, year: 2024, source: "EMA" };
const data: EnergySavingsChecksDto = {
  projectId: "sktc",
  carbon,
  canEdit: true,
  checks: [
    { id: "c1", projectId: "sktc", name: "LED fittings in 264E corridors", changeDate: "2026-11-01", meterIds: ["m1", "m2"], createdAt: "2026-11-02T00:00:00.000Z" },
    { id: "c2", projectId: "sktc", name: "Timer moved", changeDate: "2026-11-08", meterIds: [], createdAt: "2026-11-08T00:00:00.000Z" },
  ],
};
const devices = [{ id: "m1", name: "264E L1-L6A Blk common Area Lighting · Block Common Area Lighting 1", boardId: "b1" }, { id: "m2", name: "264E Level 2-lvl17 Common Area Lighting", boardId: "b1" }];

it("shows each change's saving with money, a year's worth and carbon, and says when it is too early", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const outcomes = {
    c1: { result: { status: "saving" as const, baselineDays: 28, afterDays: 9, expectedKwh: 104.4, actualKwh: 73.1, savedKwh: 31.3, savedPct: 30, savedKwhPerYear: 1269, noiseKwh: 6 }, ratePerKwh: 0.3, currency: "SGD" },
    c2: { result: { status: "too-early" as const, baselineDays: 28, afterDays: 1 } },
  };
  await act(async () => root.render(<SiteSavingsView data={data} devices={devices} outcomes={outcomes} busy={false} error={null} onSave={vi.fn()} onRemove={vi.fn()} />));
  expect(host.textContent).toContain("LED fittings in 264E corridors");
  expect(host.textContent).toContain("2 devices: 264E L1-L6A Blk common Area Lighting, 264E Level 2-lvl17 Common Area Lighting");
  expect(host.textContent).toContain("Saved 31.3 kWh (30%)");
  expect(host.textContent).toContain("About S$9 so far");
  expect(host.textContent).toContain("About 1,269 kWh and S$381 a year");
  expect(host.textContent).toContain("13 kg CO2e avoided so far");
  expect(host.textContent).toContain("9 complete days since the change, compared with 28 days before it");
  expect(host.textContent).toContain("Too early to tell: 1 of 3 complete days since the change.");
  await act(async () => root.unmount());
});

it("records a change for some devices, asking for at least one", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SiteSavingsView data={{ ...data, checks: [] }} devices={devices} outcomes={{}} busy={false} error={null} onSave={onSave} onRemove={vi.fn()} />));
  expect(host.textContent).toContain("No changes recorded yet");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Record a change") as HTMLButtonElement).click());
  const setValue = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  await setValue(host.querySelector('input[aria-label="What changed"]') as HTMLInputElement, "LED fittings");
  await setValue(host.querySelector('input[aria-label="Date of the change"]') as HTMLInputElement, "2026-11-01");
  const radios = host.querySelectorAll('input[type="radio"]');
  await act(async () => (radios[1] as HTMLInputElement).click());
  const form = host.querySelector("form")!;
  await act(async () => form.requestSubmit());
  expect(host.textContent).toContain("Pick at least one device.");
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => form.requestSubmit());
  expect(onSave).toHaveBeenCalledWith({ name: "LED fittings", changeDate: "2026-11-01", meterIds: ["m1"] });
  await act(async () => root.unmount());
});
