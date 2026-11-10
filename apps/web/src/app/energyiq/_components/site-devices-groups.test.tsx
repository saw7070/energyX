/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ search: "", push: vi.fn(), analysis: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push, replace: vi.fn() }), usePathname: () => "/energyiq/project-configuration", useSearchParams: () => new URLSearchParams(mock.search) }));
vi.mock("../../../lib/config-api", () => ({ configApi: { executeEnergyScopeAnalysis: mock.analysis, getEnergyOperationalPolicies: vi.fn(async () => null), getEnergyProjectInformation: vi.fn(async () => null), getEnergyProjectMeterHealth: vi.fn(async () => ({ meters: [] })) } }));

import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { SiteDevices } from "./site-devices";

const health = { coveragePct: 100, expectedMeterIntervalCount: 96, validIntervalCount: 96, qualityEventCount: 0 };
const meters = [
  { id: "lobby", name: "Lift lobby 1", fullName: "264F GF Lobby Lighting · Groundfloor lift lobby", scopeId: "f-gf", kwh: 3 },
  { id: "deco", name: "264F Decorative light", scopeId: "f-gf", kwh: 1 },
  { id: "e-lobby", name: "264E Lift lobby", scopeId: "blk-e", kwh: 2 },
  { id: "sign", name: "Entrance", fullName: "264F Compassvale Bow signboard", panel: "264F", scopeId: "entrance", kwh: 0.5 },
  { id: "pav", name: "Pavilion 1", scopeId: "pavilion", kwh: 0.5 },
];
const analysis = (scopeId: string) => {
  const inside = scopeId === "project" ? meters : meters.filter(item => item.scopeId === scopeId || (scopeId === "blk-f" && item.scopeId === "f-gf") || (scopeId === "common" && ["entrance", "pavilion"].includes(item.scopeId)));
  const usageKwh = inside.reduce((sum, item) => sum + item.kwh, 0);
  return {
    context: { from: "2026-11-01T16:00:00.000Z", to: "2026-11-08T16:00:00.000Z", timezone: "Asia/Singapore" },
    summary: { usageKwh, averageDailyUsageKwh: usageKwh / 7, peakKw: 1, peakAt: "2026-11-03T03:00:00.000Z" },
    circuits: inside.map(item => ({ meterNodeId: item.id, name: item.name, usageKwh: item.kwh, peakKw: 0.2, dataHealth: health })),
    explorerMeters: inside.map(item => ({ id: item.id, name: item.name, ...(item.fullName ? { fullName: item.fullName } : {}), ...(item.panel ? { panel: item.panel } : {}), scopeId: item.scopeId, kind: "physical", role: "component", category: "light", includedInOfficialTotal: true })),
    explorerTrends: [],
    cost: { status: "unavailable" },
    offHours: { status: "unavailable" },
  };
};
const boardNames = new Map([["blk-f", "Block 264F"], ["f-gf", "Ground floor"], ["blk-e", "Block 264E"], ["common", "Common area"], ["pavilion", "Pavilion"], ["entrance", "Entrance"]]);
const boardParents = new Map([["f-gf", "blk-f"], ["pavilion", "common"], ["entrance", "common"]]);

async function show(search = "") {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.search = search;
  mock.analysis.mockImplementation(async ({ scopeId }: { scopeId: string }) => analysis(scopeId));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><SiteDevices projectId={`groups-${search}`} boardNames={boardNames} boardParents={boardParents} /></EnergyIqLocaleProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); } };
}

it("shows the top-level groups as tabs and where the energy goes group by group", async () => {
  const { host, done } = await show();
  try {
    const tabs = Array.from(host.querySelector('[role="group"][aria-label="Show the whole site or one group"]')!.querySelectorAll("button")).map(button => button.textContent);
    expect(tabs).toEqual(["Whole site", "Block 264E", "Block 264F", "Common area"]);
    const tree = host.querySelector('[role="group"][aria-label="Energy by group"]')!;
    const rows = Array.from(tree.querySelectorAll("li")).map(item => item.getAttribute("aria-label"));
    expect(rows).toEqual(expect.arrayContaining([
      "Block 264F: 4 kWh, 57% of Whole site",
      "Ground floor: 4 kWh, 100% of Block 264F",
      "Common area: 1 kWh, 14% of Whole site",
      "Entrance: 0.5 kWh, 50% of Common area",
    ]));
    // A group measured by one meter says so: it cannot be split any further.
    expect(tree.textContent).toContain("1 meter, no sub-meter below it");

    // The short name leads in the full table, with the installer's label and the panel underneath.
    const signRow = Array.from(host.querySelectorAll("tbody tr")).find(row => row.querySelector("th strong")?.textContent === "Entrance")!;
    expect(signRow.querySelector("th small")!.textContent).toContain("264F Compassvale Bow signboard · Panel 264F");
    const card = Array.from(host.querySelectorAll('[role="listitem"] strong')).find(item => item.textContent === "Lift lobby 1")!;
    expect(card.getAttribute("title")).toBe("Lift lobby 1 — 264F GF Lobby Lighting · Groundfloor lift lobby");

    // A top-level group that holds no meter of its own still opens with its own figures.
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Block 264F")!.click());
    expect(mock.push).toHaveBeenLastCalledWith(expect.stringContaining("view=board%3Ablk-f"), { scroll: false });
  } finally { await done(); }
});

it("opens one top-level group with its own total and the groups inside it", async () => {
  const { host, done } = await show("view=board:common");
  try {
    expect(host.querySelector("h3")!.textContent).toBe("Common area");
    expect(host.textContent).toContain("Group with 2 devices.");
    const rows = Array.from(host.querySelector('[role="group"][aria-label="Energy by group"]')!.querySelectorAll("li")).map(item => item.getAttribute("aria-label"));
    expect(rows).toEqual(expect.arrayContaining(["Entrance: 0.5 kWh, 50% of Common area", "Pavilion: 0.5 kWh, 50% of Common area"]));
    expect(rows.some(row => row?.includes("Block 264F"))).toBe(false);
  } finally { await done(); }
});
