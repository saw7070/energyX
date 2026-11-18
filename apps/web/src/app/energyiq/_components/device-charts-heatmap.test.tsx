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

/** A made-up emergency-lights circuit over three days: a steady 0.09 kWh an hour, dimmed to 0.03 at 01:00, with one 0.11 at 05:00 on Tue. */
const steady = (change: Record<number, number | null> = {}) => Array.from({ length: 24 }, (_, hour): number | null => hour in change ? change[hour]! : hour === 1 ? 0.03 : 0.09);
const week = [
  { id: "2026-11-02", name: "Mon 2 Nov", group: "Week of 2 Nov", profileKw: steady() },
  { id: "2026-11-03", name: "Tue 3 Nov", group: "Week of 2 Nov", profileKw: steady({ 5: 0.11 }) },
  { id: "2026-11-04", name: "Wed 4 Nov", group: "Week of 2 Nov", profileKw: steady({ 7: null }) },
];
const tooltipText = (host: HTMLElement) => host.querySelector("[data-heatmap] > div:last-child")!.textContent!;

it("compares each hour of a day with that hour's usual use, so a steady device reads about 100%", async () => {
  const { host, unmount } = await render(<UsageHeatmap rows={week} openHours={new Set()} scale="usual" />);
  const text = (cell: string) => host.querySelector(`[data-heat-cell="${cell}"]`)!.textContent;
  expect(text("0:3")).toBe("100%");
  // Dimmed at 01:00 every night, so 01:00 on a normal night is usual too.
  expect(text("0:1")).toBe("100%");
  // The one 0.11 stands out a little; the ordinary 0.09 beside it stays close to usual.
  expect(text("1:5")).toBe("114%");
  expect(text("0:5")).toBe("93%");
  // A missing hour stays empty, and is left out of that hour's usual use.
  expect(text("2:7")).toBe("");
  expect(host.querySelector('[data-heat-cell="2:7"]')!.getAttribute("data-heat-kind")).toBe("missing");
  expect(text("0:7")).toBe("100%");
  const legend = host.querySelector("figure > p:last-child")!.textContent!;
  expect(legend).toContain("% of this hour's usual use");
  expect(legend).toContain("Less than usual");
  expect(legend).toContain("More than usual");
  expect(legend).toContain("100% = what this device usually uses at this hour");
  expect(legend).not.toContain("busiest");
  expect(legend).not.toContain("Usually off");
  await hover(host, "1:5");
  expect(tooltipText(host)).toContain("114% of its usual use at this hour (usually 0.10 kWh)");
  expect(tooltipText(host)).toContain("0.11 kW · 0.11 kWh in this hour");
  expect(tooltipText(host)).not.toContain("average day");
  await unmount();
});

it("reads off at an hour the device is usually off, and flags a day it used energy then", async () => {
  // Lighting at 2 kW from 18:00 to 23:00 and off otherwise, over ten days; on the last day 0.02 kWh went at 03:00.
  const night = (extra: number) => Array.from({ length: 24 }, (_, hour) => hour >= 18 ? 2 : hour === 3 ? extra : 0);
  const days = Array.from({ length: 10 }, (_, day) => ({ id: `2026-11-${10 + day}`, name: `Day ${day + 1}`, group: "Week", profileKw: night(day === 9 ? 0.02 : 0) }));
  const { host, unmount } = await render(<UsageHeatmap rows={days} openHours={new Set()} scale="usual" />);
  const cell = (id: string) => host.querySelector(`[data-heat-cell="${id}"]`)!;
  expect(cell("0:3").getAttribute("data-heat-kind")).toBe("off");
  expect(cell("0:3").textContent).toBe("off");
  expect(cell("9:3").getAttribute("data-heat-kind")).toBe("usedWhileOff");
  expect(cell("9:3").textContent).toBe("!");
  expect(cell("9:3").textContent).not.toContain("%");
  expect(cell("9:20").textContent).toBe("100%");
  const legend = host.querySelector("figure > p:last-child")!.textContent!;
  expect(legend).toContain("Usually off at this hour");
  expect(legend).toContain("Used while usually off");
  await hover(host, "9:3");
  expect(tooltipText(host)).toContain("Used energy at an hour it is usually off");
  expect(tooltipText(host)).toContain("0.02 kW · 0.02 kWh in this hour");
  await hover(host, "0:3");
  expect(tooltipText(host)).toContain("Usually off at this hour");
  expect(tooltipText(host)).toContain("0.00 kW · 0.00 kWh in this hour");
  await unmount();
});

it("gives the kWh really recorded for an hour only partly received, and says so", async () => {
  // 03:00 on Mon 2 Nov: 30 of 60 minutes arrived carrying 0.10 kWh, so its kW (0.20) is worked out from that half.
  const partial = profile.map(() => null as number | null);
  partial[3] = 0.1;
  const days = [{ id: "2026-11-02", name: "Mon 2 Nov", group: "Week of 2 Nov", profileKw: profile.map((kw, hour) => hour === 3 ? 0.2 : kw), partialKwh: partial }];
  const { host, unmount } = await render(<UsageHeatmap rows={days} openHours={new Set()} scale="usual" />);
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
