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
  // Moving the mouse off the heatmap hides the details.
  await act(async () => { host.querySelector('[data-heat-cell="0:20"]')!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })); });
  expect(host.querySelector("[data-heatmap] > div:last-child")!.textContent).not.toContain("kWh in this hour");
  await unmount();
});

it("keeps a tapped cell's details after the finger lifts, until a tap elsewhere", async () => {
  const { host, unmount } = await render(<div><UsageHeatmap rows={rows} openHours={new Set()} /><p>Elsewhere</p></div>);
  const tooltip = () => host.querySelector("[data-heatmap] > div:last-child")!.textContent!;
  const cell = host.querySelector('[data-heat-cell="0:5"]')!;
  // A tap: the finger goes down, comes up, and the browser then has it leave the page.
  await act(async () => {
    for (const type of ["pointerdown", "pointerup", "pointerout", "pointerleave"]) cell.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch" }));
  });
  expect(tooltip()).toContain("0.15 kW · 0.15 kWh in this hour on an average day");
  // Another cell takes its place; a tap outside the heatmap puts it away.
  await act(async () => { host.querySelector('[data-heat-cell="0:20"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })); });
  expect(tooltip()).toContain("100% of its busiest hour (0.30 kW)");
  await act(async () => { host.querySelector("p:last-child")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })); });
  expect(tooltip()).not.toContain("kWh in this hour");
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

it("gives the kWh really recorded for an hour only partly received, and says so", async () => {
  // 03:00 on Mon 2 Nov: 30 of 60 minutes arrived carrying 0.10 kWh, so its kW (0.20) is worked out from that half.
  const partial = profile.map(() => null as number | null);
  partial[3] = 0.1;
  const days = [{ id: "2026-11-02", name: "Mon 2 Nov", group: "Week of 2 Nov", profileKw: profile.map((kw, hour) => hour === 3 ? 0.2 : kw), partialKwh: partial }];
  const { host, unmount } = await render(<UsageHeatmap rows={days} openHours={new Set()} scale="all" />);
  await hover(host, "0:3");
  let tooltip = host.querySelector("[data-heatmap] > div:last-child")!.textContent!;
  expect(tooltip).toContain("0.20 kW · 0.10 kWh in this hour");
  expect(tooltip).toContain("Only part of this hour's readings arrived.");
  await hover(host, "0:20");
  tooltip = host.querySelector("[data-heatmap] > div:last-child")!.textContent!;
  expect(tooltip).toContain("0.30 kW · 0.30 kWh in this hour");
  expect(tooltip).not.toContain("Only part");
  await unmount();
});
