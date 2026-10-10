/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnergyPortfolioDto, EnergyPortfolioSiteDto, EnergyReportSchedulesDto } from "../../../lib/config-api";
import { presetPeriod } from "./portfolio-client";
import { PortfolioView } from "./portfolio-view";
import { ReportSchedulesView } from "./report-schedules";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const render = async (node: React.ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
};

const grid = { basis: "grid" as const, grid: "SG" as const, kgCo2ePerKwh: 0.402, year: 2024, source: "Energy Market Authority, Singapore Energy Statistics" };
const site = (overrides: Partial<EnergyPortfolioSiteDto>): EnergyPortfolioSiteDto => ({
  projectId: "p", name: "Site", timezone: "Asia/Singapore", status: "ok", usageKwh: 1000, averageDailyKwh: 33, peakKw: 12, previousUsageKwh: 900,
  changePct: 11.1, carbonKg: 402, carbonFactor: grid, coveragePct: 100, dataStatus: "complete", ...overrides,
});
const portfolio: EnergyPortfolioDto = {
  workspaceId: "w", workspaceName: "Acme", period: { from: "2026-09-01", to: "2026-09-30" }, generatedAt: "2026-10-01T00:00:00Z",
  sites: [
    site({ projectId: "a", name: "Raffles HQ", usageKwh: 5000, cost: { amount: 1500, currency: "SGD" }, afterHoursSharePct: 31, carbonKg: 2010,
      budget: { month: "2026-09", daysInMonth: 30, actualKwh: 5000, forecastKwh: 5000, actualCost: 1500, forecastCost: 1500, currency: "SGD", budgetAmount: 1200, status: "over" } }),
    site({ projectId: "b", name: "KL Office", country: "MY", usageKwh: 8000, changePct: -5, cost: { amount: 2600, currency: "MYR" }, carbonKg: 5920, coveragePct: 88.5, dataStatus: "partial",
      carbonFactor: { basis: "grid", grid: "MY-PENINSULAR", kgCo2ePerKwh: 0.74, year: 2024, source: "Energy Commission Malaysia", provisional: true } }),
    site({ projectId: "c", name: "Tuas Depot", status: "unavailable", usageKwh: 0, previousUsageKwh: 0, changePct: null, carbonKg: 0, coveragePct: 0, dataStatus: "unavailable" }),
  ],
  totals: { usageKwh: 13000, previousUsageKwh: 12000, carbonKg: 7930, costByCurrency: { SGD: 1500, MYR: 2600 }, sitesWithData: 2, sitesOverBudget: 1, sitesAtRisk: 0 },
};

describe("Portfolio view", () => {
  it("adds up every site without mixing currencies and compares them side by side", async () => {
    const { host, root } = await render(<PortfolioView portfolio={portfolio} />);
    expect(host.textContent).toContain("13,000 kWh");
    expect(host.textContent).toContain("+8% on the previous period");
    expect(host.textContent).toContain("S$1,500.00 + RM2,600.00");
    expect(host.textContent).toContain("7.9 tCO2e");
    expect(host.textContent).toContain("1 over · 0 heading over");
    const names = () => Array.from(host.querySelectorAll("tbody th")).map(cell => cell.textContent);
    expect(names()).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    expect(host.textContent).toContain("No readings for this period");
    expect(host.textContent).toContain("89% of readings");
    expect(host.querySelector('a[href="/energyiq/key-points?projectId=a"]')).not.toBeNull();
    expect(host.textContent).toContain("0.74 kg CO2e/kWh · Energy Commission Malaysia · 2024 (provisional) — KL Office");

    // Sorting by name puts them in order; sites without figures stay last.
    await act(async () => (host.querySelector('button[aria-label="Sort by Site"]') as HTMLButtonElement).click());
    expect(names()).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    await act(async () => (host.querySelector('button[aria-label="Sort by Carbon (t)"]') as HTMLButtonElement).click());
    expect(names()).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    await act(async () => (host.querySelector('button[aria-label="Sort by Carbon (t)"]') as HTMLButtonElement).click());
    expect(names()).toEqual(["Raffles HQ", "KL Office", "Tuas Depot"]);
    await act(async () => root.unmount());
  });

  it("picks whole periods in the sites' time zone", () => {
    const now = new Date("2026-10-10T03:00:00Z");
    expect(presetPeriod("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetPeriod("thisMonth", now)).toEqual({ from: "2026-10-01", to: "2026-10-09" });
    expect(presetPeriod("last3Months", now)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetPeriod("thisYear", now)).toEqual({ from: "2026-01-01", to: "2026-10-09" });
    // Early on the 1st in Singapore is still the 1st: "this month" is just today.
    expect(presetPeriod("thisMonth", new Date("2026-09-30T17:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });
});

describe("Scheduled report emails", () => {
  const data: EnergyReportSchedulesDto = {
    schedules: [{
      id: "s1", workspaceId: "w", name: "Monthly summary", frequency: "monthly", projectIds: [], recipientUserIds: ["u1"], localHour: 8,
      timezone: "Asia/Singapore", enabled: true, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
      lastDelivery: { periodKey: "month:2026-09", status: "sent", attempts: 1, recipientCount: 1, updatedAt: "2026-10-01T00:05:00Z" },
      nextPeriod: { from: "2026-09-01", to: "2026-09-30", key: "month:2026-09", dueDate: "2026-10-01" },
    }],
    team: [
      { userId: "u1", email: "ops@acme.test", name: "Ops Lead", canReadReports: true },
      { userId: "u2", email: "cfo@acme.test", canReadReports: true },
      { userId: "u3", email: "contractor@acme.test", canReadReports: false },
    ],
    sites: [{ id: "a", name: "Raffles HQ" }, { id: "b", name: "KL Office" }],
    defaultTimezone: "Asia/Singapore",
    emailMode: "test",
  };

  it("creates a weekly report for chosen people and sites, and asks before deleting", async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    const onDelete = vi.fn().mockResolvedValue(true);
    const props = { data, busy: false, error: null, notice: null, onCreate, onUpdate: vi.fn().mockResolvedValue(true), onDelete, onSend: vi.fn().mockResolvedValue(true) };
    const { host, root } = await render(<ReportSchedulesView {...props} />);
    expect(host.textContent).toContain("Emails are in test mode");
    expect(host.textContent).toContain("Monthly · 1 people · all sites · at 08:00");
    expect(host.textContent).not.toContain("contractor@acme.test");

    const button = (text: string) => Array.from(host.querySelectorAll("button")).find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement;
    await act(async () => button("New scheduled report").click());
    const form = host.querySelector("form")!;
    await act(async () => {
      const frequency = form.querySelector("select") as HTMLSelectElement;
      frequency.value = "weekly";
      frequency.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const labelled = (text: string) => Array.from(form.querySelectorAll("label")).find(label => label.textContent?.includes(text))!.querySelector("input") as HTMLInputElement;
    await act(async () => labelled("Chosen sites").click());
    await act(async () => labelled("KL Office").click());
    await act(async () => labelled("cfo@acme.test").click());
    await act(async () => (form.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(onCreate).toHaveBeenCalledWith({ name: "Energy summary", frequency: "weekly", projectIds: ["b"], recipientUserIds: ["u2"], localHour: 8 });

    await act(async () => button("Delete").click());
    expect(host.textContent).toContain("Delete \"Monthly summary\"?");
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => Array.from(host.querySelectorAll('[role="group"] button')).find(candidate => candidate.textContent === "Delete")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDelete).toHaveBeenCalledWith("s1");
    await act(async () => root.unmount());
  });
});
