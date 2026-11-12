/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EnergyPortfolioDto, EnergyPortfolioSiteDto } from "../../../lib/config-api";

const mock = vi.hoisted(() => ({ portfolio: vi.fn(), workspaceId: "w" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("../_components/energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { activeWorkspaceId: mock.workspaceId, workspaces: [{ id: mock.workspaceId, name: "Example Town Council" }], role: "viewer" }, error: null }) }));
vi.mock("../../../lib/config-api", () => ({ configApi: { getEnergyPortfolio: mock.portfolio } }));

import { EnergyIqPortfolio } from "./portfolio-client";

const grid = { basis: "grid" as const, grid: "SG" as const, kgCo2ePerKwh: 0.402, year: 2024, source: "Energy Market Authority, Singapore Energy Statistics" };
const site = (usageKwh: number): EnergyPortfolioSiteDto => ({
  projectId: "estate", name: "Example Estate", timezone: "Asia/Singapore", status: usageKwh > 0 ? "ok" : "unavailable", usageKwh, averageDailyKwh: usageKwh / 10, peakKw: 3, previousUsageKwh: 0,
  changePct: null, carbonKg: usageKwh * 0.402, carbonFactor: grid, coveragePct: usageKwh > 0 ? 100 : 0, dataStatus: usageKwh > 0 ? "complete" : "unavailable",
});
const answer = (period: { from: string; to: string }, usageKwh: number): EnergyPortfolioDto => ({
  workspaceId: "w", workspaceName: "Example Town Council", period, generatedAt: "2026-11-11T00:00:00Z", sites: [site(usageKwh)],
  totals: { usageKwh, previousUsageKwh: 0, carbonKg: usageKwh * 0.402, costByCurrency: {}, sitesWithData: usageKwh > 0 ? 1 : 0, sitesOverBudget: 0, sitesAtRisk: 0 },
});
// 11 November 2026 in Singapore: last month is October, this month runs to yesterday, 10 November.
const LAST_MONTH = { from: "2026-10-01", to: "2026-10-31" };
const THIS_MONTH = { from: "2026-11-01", to: "2026-11-10" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-11T03:00:00Z"));
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.workspaceId = "w";
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); mock.portfolio.mockReset(); document.body.innerHTML = ""; });

const render = async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqPortfolio />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { host, root };
};
const pressed = (host: HTMLElement) => host.querySelector('[role="radio"][aria-checked="true"]')?.textContent;
const click = async (host: HTMLElement, name: string) => {
  await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(button => button.textContent === name)!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

it("opens on this month when no site has readings for last month yet, and says why", async () => {
  // A site connected on 3 November: nothing for October, 1,234 kWh so far this month.
  mock.portfolio.mockImplementation(async (period: { from: string }) => answer(period as typeof LAST_MONTH, period.from === THIS_MONTH.from ? 1234 : 0));
  const { host, root } = await render();
  expect(mock.portfolio.mock.calls.map(call => call[0])).toEqual([LAST_MONTH, THIS_MONTH]);
  expect(pressed(host)).toBe("This month");
  expect(host.textContent).toContain("1 Nov 2026 – 10 Nov 2026");
  expect(host.textContent).toContain("1,234 kWh");
  expect(host.textContent).toContain("No site has readings for last month yet, so this shows the latest period that has them.");

  // A period the reader picks is kept, even one with no readings.
  await click(host, "Last month");
  expect(mock.portfolio).toHaveBeenLastCalledWith(LAST_MONTH);
  expect(pressed(host)).toBe("Last month");
  expect(host.textContent).not.toContain("No site has readings for last month yet");
  expect(mock.portfolio).toHaveBeenCalledTimes(3);
  await act(async () => root.unmount());
});

it("stays on last month when it has readings", async () => {
  mock.portfolio.mockImplementation(async (period: { from: string }) => answer(period as typeof LAST_MONTH, 5000));
  const { host, root } = await render();
  expect(mock.portfolio.mock.calls.map(call => call[0])).toEqual([LAST_MONTH]);
  expect(pressed(host)).toBe("Last month");
  expect(host.textContent).not.toContain("No site has readings for last month yet");
  await act(async () => root.unmount());
});

it("stays on last month, empty, when no period has readings at all", async () => {
  mock.portfolio.mockImplementation(async (period: { from: string }) => answer(period as typeof LAST_MONTH, 0));
  const { host, root } = await render();
  expect(mock.portfolio).toHaveBeenCalledTimes(4);
  expect(pressed(host)).toBe("Last month");
  expect(host.textContent).toContain("1 Oct 2026 – 31 Oct 2026");
  expect(host.textContent).not.toContain("No site has readings for last month yet");
  await act(async () => root.unmount());
});

it("keeps the reader's choice when they pick a period while the page is still looking", async () => {
  let release: (() => void) | undefined;
  mock.portfolio.mockImplementation(async (period: { from: string }) => {
    if (period.from === THIS_MONTH.from && !release) await new Promise<void>(resolve => { release = resolve; });
    return answer(period as typeof LAST_MONTH, period.from === "2026-01-01" || period.from === THIS_MONTH.from ? 800 : 0);
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqPortfolio />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await click(host, "This year");
  release?.();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(pressed(host)).toBe("This year");
  expect(host.textContent).toContain("1 Jan 2026 – 10 Nov 2026");
  expect(host.textContent).not.toContain("No site has readings for last month yet");
  await act(async () => root.unmount());
});
