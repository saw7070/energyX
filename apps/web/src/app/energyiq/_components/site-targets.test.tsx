/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EnergyProjectTargetsDto } from "../../../lib/config-api";
import { SiteTargetsView } from "./site-targets";

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const official = { basis: "grid" as const, grid: "MY-PENINSULAR" as const, kgCo2ePerKwh: 0.74, year: 2024, source: "Energy Commission Malaysia, Grid Emission Factor (Peninsular)", provisional: true };
const targets: EnergyProjectTargetsDto = {
  projectId: "kl",
  budget: { monthlyAmount: 3000, currency: "MYR" },
  carbon: official,
  gridCarbon: official,
  overnight: { enabled: true, thresholdPct: 30 },
  currency: "MYR",
  canEdit: true,
  status: {
    budget: { month: "2026-10", dataThrough: "2026-10-09", daysInMonth: 31, actualKwh: 4000, forecastKwh: 13000, actualCost: 1100, forecastCost: 3575, currency: "MYR", budgetAmount: 3000, status: "at-risk" },
    overnight: { night: "2026-10-09", nightKw: 3.5, usualKw: 2, abovePct: 75, extraKwh: 9, nightsCompared: 28 },
  },
};

it("shows where the budget stands, the official carbon factor and last night's warning, and saves changes", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SiteTargetsView targets={targets} busy={false} error={null} notice={null} onSave={onSave} />));
  expect(host.textContent).toContain("RM3,000 a month");
  expect(host.textContent).toContain("Heading over");
  expect(host.textContent).toContain("RM1,100 spent of RM3,000");
  expect(host.textContent).toContain("Forecast for the month: RM3,575");
  expect(host.textContent).toContain("0.74 kg CO2e per kWh");
  expect(host.textContent).toContain("Official grid figure");
  expect(host.textContent).toContain("(provisional)");
  expect(host.textContent).toContain("3.5 kW against a usual 2 kW (75% above)");

  const button = (text: string) => Array.from(host.querySelectorAll("button")).find(candidate => candidate.textContent === text) as HTMLButtonElement;
  // Change the budget and add a kWh budget.
  await act(async () => Array.from(host.querySelectorAll("section section")).find(card => card.textContent?.includes("Monthly budget"))!.querySelector("button")!.click());
  const setValue = async (label: string, value: string) => {
    const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  await setValue("Electricity budget per month", "3200");
  await setValue("Energy budget per month (optional)", "12000");
  await act(async () => button("Save").click());
  expect(onSave).toHaveBeenCalledWith({ budget: { monthlyAmount: 3200, currency: "MYR", monthlyKwh: 12000 } });

  // Turning the overnight check off saves straight away.
  await act(async () => button("Off").click());
  expect(onSave).toHaveBeenLastCalledWith({ overnight: { enabled: false } });
  await act(async () => root.unmount());
});

it("is read-only for people who cannot change hours and rates", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SiteTargetsView targets={{ ...targets, canEdit: false, budget: undefined, status: undefined } as EnergyProjectTargetsDto} busy={false} error={null} notice={null} onSave={vi.fn()} />));
  expect(host.textContent).toContain("Only people allowed to change this site's hours and rate");
  expect(host.textContent).toContain("No budget set.");
  expect(Array.from(host.querySelectorAll("button")).some(candidate => candidate.textContent === "Edit" || candidate.textContent === "Set a budget")).toBe(false);
  expect((Array.from(host.querySelectorAll("button")).find(candidate => candidate.textContent === "Off") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => root.unmount());
});
