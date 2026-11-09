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
  peak: { enabled: true, limitKw: 120, warnPct: 90 },
  alertRecipients: [],
  alertTeam: [{ email: "facilities@client.com", name: "Facilities team" }],
  emailMode: "smtp",
  currency: "MYR",
  canEdit: true,
  status: {
    budget: { month: "2026-10", dataThrough: "2026-10-09", daysInMonth: 31, actualKwh: 4000, forecastKwh: 13000, actualCost: 1100, forecastCost: 3575, currency: "MYR", budgetAmount: 3000, status: "at-risk" },
    overnight: { night: "2026-10-09", nightKw: 3.5, usualKw: 2, abovePct: 75, extraKwh: 9, nightsCompared: 28 },
    peak: { month: "2026-10", peakKw: 112.4, peakAt: "2026-10-07T07:30:00.000Z", peakHoursOnly: true, latestDay: "2026-10-09", latestDayPeakKw: 98, previousPeakKw: 105, newHigh: false, limitKw: 120, warnPct: 90, limitStatus: "near", demandCharge: { perKwMonth: 97.06, currency: "MYR", amount: 10909.54 } },
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
  expect(host.querySelector('[aria-label="0.74 kg CO2e per kWh"]')).not.toBeNull();
  expect(host.textContent).toContain("Electricity used (kWh) × 0.74 = Scope 2 emissions (kg CO2e)");
  expect(host.textContent).toContain("Left in budget");
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
  await act(async () => (host.querySelector('button[role="switch"]') as HTMLButtonElement).click());
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
  expect((host.querySelector('button[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => root.unmount());
});

it("shows this month's peak against the limit, saves a new limit, and builds the site's alert list", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SiteTargetsView targets={targets} busy={false} error={null} notice={null} onSave={onSave} />));
  const card = (title: string) => Array.from(host.querySelectorAll("section section")).find(candidate => candidate.querySelector("h4")?.textContent === title)!;
  const peak = card("Peak demand");
  expect(peak.textContent).toContain("Limit 120 kW · warn at 90%");
  expect(peak.textContent).toContain("112.4 kW");
  expect(peak.textContent).toContain("Reached 94% of the limit");
  expect(peak.textContent).toContain("Peak hours only, as your tariff bills it");
  expect(peak.textContent).toContain("About RM10,910 this month at RM97.06 per kW");

  const setValue = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  await act(async () => Array.from(peak.querySelectorAll("button")).find(button => button.textContent === "Edit")!.click());
  await setValue(peak.querySelector('input[aria-label="Limit (kW)"]') as HTMLInputElement, "150");
  await act(async () => (Array.from(peak.querySelectorAll('button[role="radio"]')).find(button => button.textContent === "95%") as HTMLButtonElement).click());
  await act(async () => Array.from(peak.querySelectorAll("button")).find(button => button.textContent === "Save")!.click());
  expect(onSave).toHaveBeenLastCalledWith({ peak: { limitKw: 150, warnPct: 95 } });

  const alerts = card("Alert emails");
  expect(alerts.textContent).toContain("Nobody receives this site's alerts yet");
  const other = alerts.querySelector('input[aria-label="Another address"]') as HTMLInputElement;
  await setValue(other, "not-an-email");
  await act(async () => Array.from(alerts.querySelectorAll("button")).find(button => button.textContent === "Add")!.click());
  expect(alerts.textContent).toContain("Enter a full email address");
  await setValue(other, "Charles@Client.com ");
  await act(async () => Array.from(alerts.querySelectorAll("button")).find(button => button.textContent === "Add")!.click());
  expect(onSave).toHaveBeenLastCalledWith({ alertEmails: ["charles@client.com"] });
  await act(async () => root.unmount());
});
