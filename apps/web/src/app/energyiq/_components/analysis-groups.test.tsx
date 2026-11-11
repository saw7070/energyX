/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisData, ScopeData, TrendCell } from "./analysis-data";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: mock.load }));

import { AnalysisView } from "./analysis-view";
import { DecisionSummary } from "./analysis-story";
import { scopeDays } from "./analysis-model";

// One week (Mon 10 – Sun 16 Aug): 2 kW always on, 6 kW while open 09:00–18:00.
const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0;
const series = (id: string, kwhAt: (date: string, hour: number) => number) => ({ id, expectedMinutesPerHour: 60, cells: dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwhAt(date, hour), 60, 0] as TrendCell)) });
const siteKwh = (date: string, hour: number) => weekday(date) && hour >= 9 && hour < 18 ? 6 : 2;
const scope = (id: string, name: string, extra: Partial<ScopeData> = {}): ScopeData => ({
  id, name, dates, timezone: "Asia/Singapore", total: series("__scope__", siteKwh), types: { light: series("__category__:light", siteKwh) }, meters: [],
  usageKwh: 0, peakKw: 6, peakAt: null, cost: null, typeTotals: { light: 0 }, coverage: 100, ...extra,
});
const usage = 516; // 5 weekdays × (9 h × 6 + 15 h × 2) + 2 weekend days × 24 h × 2
const project = scope("project", "Estate", { usageKwh: usage, typeTotals: { light: usage }, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh" } });
const hours = { from: "09:00", to: "18:00" };
const withoutGroups: AnalysisData = {
  projectId: "estate", projectName: "Estate", timezone: "Asia/Singapore", snapshotId: "snap",
  current: { project, spaces: [scope("blk-a", "Block A", { usageKwh: 300 }), scope("common", "Common area", { usageKwh: 216 })] }, previous: null, history: null,
  circuits: [
    { id: "gf", name: "Lift lobby", location: "Ground floor", category: "light", kwh: 300, previousKwh: null },
    { id: "sign", name: "Entrance sign", fullName: "264F Compassvale Bow signboard", location: "Entrance", category: "light", kwh: 150, previousKwh: null },
    { id: "p1", name: "Pavilion 1", location: "Pavilion", category: "light", kwh: 40, previousKwh: null },
    { id: "p2", name: "Pavilion 2", location: "Pavilion", category: "light", kwh: 26, previousKwh: null },
  ],
  holidays: new Map(), openingHours: { monday: [hours], tuesday: [hours], wednesday: [hours], thursday: [hours], friday: [hours] }, actions: [],
};
// Block A › Ground floor; Common area › Entrance (one meter, wired from Block A's panel) and Pavilion.
const data: AnalysisData = {
  ...withoutGroups,
  groups: {
    list: [
      { id: "blk-a", name: "Block A", parentId: null }, { id: "gf-group", name: "Ground floor", parentId: "blk-a" },
      { id: "common", name: "Common area", parentId: null }, { id: "entrance", name: "Entrance", parentId: "common" }, { id: "pavilion", name: "Pavilion", parentId: "common" },
    ],
    meters: [
      { id: "gf", name: "Lift lobby", groupId: "gf-group", kwh: 300 },
      { id: "sign", name: "Entrance sign", fullName: "264F Compassvale Bow signboard", groupId: "entrance", kwh: 150 },
      { id: "p1", name: "Pavilion 1", groupId: "pavilion", kwh: 40 },
      { id: "p2", name: "Pavilion 2", groupId: "pavilion", kwh: 26 },
    ],
  },
};
const text = (markup: string) => markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
// The shared group breakdown is compiled with the page's JSX runtime, which these tests provide as a global.
const story = (input: AnalysisData) => (vi.stubGlobal("React", React), renderToStaticMarkup)(<DecisionSummary data={input} days={scopeDays(project, input.holidays)} anomalies={[]} floor={null} rate={0.3} />);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(node: ReactNode) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("where the energy goes, by group", () => {
  it("splits the story by group as the Overview does: each group's kWh on an average day and its share of all use", () => {
    const markup = story(data);
    const words = text(markup);
    expect(words).toContain("By group");
    expect(words).not.toContain("By area");
    // An average day is 516 / 7 = 73.7 kWh. Block A 300 of 516 kWh is 58% (42.9 kWh a day); Common area 216 is 42%,
    // of which Entrance 150 (29% of all use) and Pavilion 66 (13%), adding up to Common area's 42%.
    expect(words).toContain("Block A accounts for 58% of the bill");
    expect(words).toContain("Block A 43 kWh a day · 58%");
    expect(words).toContain("Common area 31 kWh a day · 42%");
    expect(words).toContain("Entrance 21 kWh a day · 29%");
    expect(words).toContain("Pavilion 9.4 kWh a day · 13%");
    expect(markup).toContain('aria-label="Inside Common area"');
    // Every group is a button that opens the groups inside it.
    expect(markup).toMatch(/<button type="button"[^>]*aria-expanded="false" aria-controls="[^"]+"><span[^>]*>Common area<\/span>/);
    // Only one type of use (lighting): a split by type would say nothing beside it.
    expect(words).not.toContain("By type of use");
  });

  it("keeps the split by area for readings saved before groups existed", () => {
    const words = text(story(withoutGroups));
    expect(words).toContain("By area");
    expect(words).not.toContain("By group");
  });

  it("lets Analysis switch where the energy goes to a nested split by group, and only when the readings have groups", async () => {
    mock.load.mockResolvedValue(data);
    const page = await render(<AnalysisView projectId="estate" />);
    const toggle = page.host.querySelector('[role="group"][aria-label="Split by"]')!;
    expect(toggle).not.toBeNull();
    await act(async () => Array.from(toggle.querySelectorAll("button")).find(button => button.textContent === "Group")!.click());
    expect(page.host.textContent).toContain("All 7 days. Each group's total and its share of the group above it.");
    expect(page.host.querySelector('[aria-label="Common area: 216 kWh, 42% of Estate"]')).not.toBeNull();
    expect(page.host.querySelector('[aria-label="Entrance: 150 kWh, 69% of Common area"]')).not.toBeNull();
    expect(page.host.querySelector('[aria-label="Pavilion 1: 40 kWh, 61% of Pavilion"]')).not.toBeNull();
    // The biggest circuits list names the short name first and keeps the full label underneath.
    const row = Array.from(page.host.querySelectorAll("td")).find(cell => cell.textContent?.startsWith("Entrance sign"))!;
    expect(row.querySelector("small")?.textContent).toBe("264F Compassvale Bow signboard");
    await page.unmount();

    mock.load.mockResolvedValue(withoutGroups);
    const plain = await render(<AnalysisView projectId="estate" />);
    expect(plain.host.querySelector('[aria-label="Split by"]')).toBeNull();
    await plain.unmount();
  });
});
