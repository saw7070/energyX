/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SiteReport } from "@datafoundry/site-report";
import { DailyEnergyChart } from "./daily-energy-chart";

const day = (date: string, dow: string, kwh: number, extra: Record<string, unknown> = {}) => ({ date, dow, kwh, dayType: "weekday", complete: true, recoveredKwh: 0, ...extra });
const report = (days: unknown[]) => ({ benchmark: { days }, rate: 0.276, currency: "SGD", averageDay: { kwh: 47, cost: 13, text: "" } }) as unknown as SiteReport;

async function render(days: unknown[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<DailyEnergyChart report={report(days)} />));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); } };
}

it("names the meter that was offline and sent its energy late", async () => {
  const { host, done } = await render([
    day("2026-11-15", "Sun", 47),
    day("2026-11-16", "Mon", 40, { complete: false, recoveredKwh: 2.5, recoveredFrom: [{ name: "Pavilion 2", kwh: 2.5 }] }),
    day("2026-11-17", "Tue", 36, { complete: false, recoveredKwh: 1.4, recoveredFrom: [{ name: "Pavilion 2", kwh: 1.4 }] }),
  ]);
  try {
    const note = host.querySelector('[role="note"]')!;
    expect(note.textContent).toBe("!Pavilion 2 was offline on 16 Nov, 17 Nov. It kept counting and sent 3.9 kWh when it came back, so those days include it (paler bars).");
    expect(note.querySelector("strong")?.textContent).toBe("Pavilion 2");
  } finally { await done(); }
});

it("lists several meters, largest first, and keeps the general sentence for reports saved without names", async () => {
  const many = await render([
    day("2026-11-15", "Sun", 47),
    day("2026-11-16", "Mon", 44, { complete: false, recoveredKwh: 4, recoveredFrom: [{ name: "Driveway", kwh: 1 }, { name: "Pavilion 2", kwh: 3 }] }),
  ]);
  try { expect(many.host.querySelector('[role="note"]')!.textContent).toContain("Pavilion 2 and Driveway were offline on 16 Nov."); } finally { await many.done(); }
  const old = await render([day("2026-11-15", "Sun", 47), day("2026-11-16", "Mon", 44, { complete: false, recoveredKwh: 4 })]);
  try { expect(old.host.querySelector('[role="note"]')!.textContent).toContain("Some meters were offline on 16 Nov."); } finally { await old.done(); }
});

it("lists the devices that sent a day's energy late in the hover box, largest first, each with its kWh", async () => {
  const from = ["264F L2–L17", "Compassvale Bow Entrance Lighting", "264F Lift lobby 1", "264F L1–L6A", "264F Emergency Lighting", "264F RA-RB lift lobby 2", "264F Decorative light"].map((name, index) => ({ name, kwh: 3 - index * 0.4 }));
  const { host, done } = await render([day("2026-11-16", "Mon", 47), day("2026-11-17", "Tue", 45.8, { complete: false, recoveredKwh: 10.2, recoveredFrom: from })]);
  try {
    await act(async () => (host.querySelectorAll("svg rect[tabindex]")[1] as SVGElement).dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    const tip = host.querySelector('[role="status"]')!;
    expect(tip.querySelector("em")!.firstChild!.textContent).toBe("Includes 10.2 kWh sent late by these 7 devices after an outage:");
    const items = [...tip.querySelectorAll("li")].map(item => item.textContent);
    expect(items.slice(0, 2)).toEqual(["264F L2–L173.0 kWh", "Compassvale Bow Entrance Lighting2.6 kWh"]);
    // All seven fit: the hover box lists up to twelve before "N more".
    expect(items).toHaveLength(7);
    expect(items.at(-1)).toBe("264F Decorative light0.6 kWh");
    // The note under the chart keeps the full list, which can be opened and stays open.
    const list = host.querySelector('[role="note"] details')!;
    expect(list.querySelector("summary")!.textContent).toBe("Show all 7 devices");
    expect([...list.querySelectorAll("li")].map(item => item.textContent)[0]).toBe("264F L2–L1717 Nov3.0 kWh");
  } finally { await done(); }
});
