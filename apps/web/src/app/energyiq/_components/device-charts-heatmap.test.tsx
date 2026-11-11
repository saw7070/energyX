/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { UsageHeatmap } from "./device-charts";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const render = async (node: React.ReactNode) => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, unmount: () => act(async () => root.unmount()) };
};
const hover = async (host: HTMLElement, cell: string) => {
  const target = host.querySelector(`[data-heat-cell="${cell}"]`)!;
  await act(async () => { target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })); });
};

/** A made-up lobby circuit: busiest at 20:00 with 0.3 kW, and all but idle (0.004 kW) at 03:00. */
const profile = Array.from({ length: 24 }, (_, hour) => hour === 20 ? 0.3 : hour === 3 ? 0.004 : hour === 12 ? null : 0.15);
const rows = [{ id: "lobby", name: "Lobby lights", group: "Block A", profileKw: profile }];

it("shows 0% for an hour that used next to nothing, and names what 100% is", async () => {
  const { host, unmount } = await render(<UsageHeatmap rows={rows} openHours={new Set([18, 19, 20, 21, 22, 23])} />);
  expect(host.querySelector('[data-heat-cell="0:3"]')!.textContent).toBe("0%");
  expect(host.querySelector('[data-heat-cell="0:20"]')!.textContent).toBe("100%");
  expect(host.querySelector('[data-heat-cell="0:12"]')!.textContent).toBe("");
  const legend = host.querySelector("figure > p:last-child")!.textContent!;
  expect(legend).toContain("% of this device's busiest hour");
  expect(legend).toContain("100% is each device’s own busiest hour. Hover over a cell for its kW and kWh.");
  await unmount();
});

it("gives each cell's power and energy in its tooltip, beside its share of the busiest hour", async () => {
  const { host, unmount } = await render(<UsageHeatmap rows={rows} openHours={new Set([18, 19, 20, 21, 22, 23])} />);
  await hover(host, "0:3");
  let tooltip = host.querySelector("[data-heatmap] > div:last-child")!.textContent!;
  expect(tooltip).toContain("0% of its busiest hour (0.30 kW)");
  expect(tooltip).toContain("0.00 kW · 0.00 kWh in this hour on an average day");
  await hover(host, "0:20");
  tooltip = host.querySelector("[data-heatmap] > div:last-child")!.textContent!;
  expect(tooltip).toContain("100% of its busiest hour (0.30 kW)");
  expect(tooltip).toContain("0.30 kW · 0.30 kWh in this hour on an average day");
  expect(tooltip).toContain("Lobby lights · 20:00–21:00 · open");
  // A tap works like hovering, for touch screens.
  await act(async () => { host.querySelector('[data-heat-cell="0:5"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(host.querySelector("[data-heatmap] > div:last-child")!.textContent).toContain("0.15 kW · 0.15 kWh in this hour on an average day");
  await unmount();
});

it("speaks of one day's hour when each row is a day of one device", async () => {
  const days = [{ id: "2026-11-02", name: "Mon 2 Nov", group: "Week of 2 Nov", profileKw: profile }, { id: "2026-11-03", name: "Tue 3 Nov", group: "Week of 2 Nov", profileKw: profile.map(kw => kw === null ? null : kw / 2) }];
  const { host, unmount } = await render(<UsageHeatmap rows={days} openHours={new Set()} scale="all" />);
  await hover(host, "1:20");
  const tooltip = host.querySelector("[data-heatmap] > div:last-child")!.textContent!;
  expect(tooltip).toContain("50% of its busiest hour (0.30 kW)");
  expect(tooltip).toContain("0.15 kW · 0.15 kWh in this hour");
  expect(tooltip).not.toContain("average day");
  expect(host.querySelector("figure > p:last-child")!.textContent).toContain("100% is the busiest hour in the whole period.");
  await unmount();
});
