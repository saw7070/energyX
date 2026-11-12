/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSiteReport } from "@datafoundry/site-report";
import type { AnalysisData, ScopeData, TrendSeries } from "./analysis-data";
import { DecisionSummary } from "./analysis-story";
import { scopeDays } from "./analysis-model";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";

// A made-up estate, ten days from Monday 2 Nov 2026, lights on 19:00 → 07:00 every night. Block A's lobby lights draw
// 1 kW and the common area's playground lights 0.5 kW at night: 18 kWh a day. On Thursday 5 Nov the lobby lights were
// also on from 10 am to 2 pm, 4 kWh in the daytime, so that day used 22 kWh.
const DATES = Array.from({ length: 10 }, (_, index) => new Date(Date.parse("2026-11-02T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const ODD_DAY = "2026-11-05";
const night = (hour: number) => hour >= 19 || hour < 7;
const lobby = (date: string, hour: number) => night(hour) || (date === ODD_DAY && hour >= 10 && hour < 14) ? 1 : 0;
const playground = (_date: string, hour: number) => night(hour) ? 0.5 : 0;
const series = (id: string, kwhAt: (date: string, hour: number) => number): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwhAt(date, hour), 60, 0] as TrendSeries["cells"][number])) });
const both = (date: string, hour: number) => lobby(date, hour) + playground(date, hour);
const usage = DATES.length * 18 + 4;
const estate: ScopeData = {
  id: "estate", name: "Estate", dates: DATES, timezone: "Asia/Singapore", total: series("__scope__", both), types: { light: series("__category__:light", both) },
  meters: [
    { id: "lobby", name: "Lobby lights", location: "Block A", category: "light", official: true, series: series("lobby", lobby) },
    { id: "playground", name: "Playground lights", location: "Common area", category: "light", official: true, series: series("playground", playground) },
  ],
  usageKwh: usage, peakKw: 2, peakAt: null, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh" }, typeTotals: { light: usage }, coverage: 100,
};
const nights = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));
const DATA: AnalysisData = {
  projectId: "estate", projectName: "Estate", timezone: "Asia/Singapore", snapshotId: null, current: { project: estate, spaces: [] }, previous: null, history: null,
  circuits: [], holidays: new Map(), openingHours: nights, actions: [], hoursMeaning: "lights_on",
  groups: {
    list: [{ id: "block-a", name: "Block A", parentId: null }, { id: "common", name: "Common area", parentId: null }],
    meters: [{ id: "lobby", name: "Lobby lights", groupId: "block-a", kwh: 9 * 12 + 16 }, { id: "playground", name: "Playground lights", groupId: "common", kwh: DATES.length * 6 }],
  },
};

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(node: ReactNode, locale: EnergyIqLocale = "en") {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Charts have no size in this test DOM; only the wording around them matters here. The forecast's policies are not
  // served here either, so its step stays on "working out".
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => (host.textContent ?? "").replace(/\s+/g, " "), unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const summary = (data: AnalysisData = DATA) => <DecisionSummary data={data} days={scopeDays(data.current.project, data.holidays)} anomalies={[]} floor={null} rate={0.3} />;
const section = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
const bold = (text: string) => text.replace(/\*\*/g, "");

describe("Analysis follows the site report", () => {
  const report = buildSiteReport(DATA, null, "2026-11-12T00:00:00.000Z");

  it("tells the story in the report's order: average day, by group, daytime use, hour by hour, days that stood out, savings", async () => {
    const page = await render(summary());
    const order = [...page.host.querySelectorAll("section[id^='story-']")].map(item => item.id);
    expect(order).toEqual(["story-money", "story-on", "story-when", "story-days", "story-plan", "story-health", "story-ahead"]);
    expect([...page.host.querySelectorAll("nav button")].map(button => button.textContent)).toEqual([
      "1 · Where the money goes", "2 · What stays on", "3 · An average day", "4 · Days that stood out", "5 · Savings plan", "6 · Health check", "7 · Next month's forecast", "Detailed analysis",
    ]);
    // It leads with the report's average day and its cost: 9 days of 18 kWh and one of 22 kWh.
    expect(report.averageDay?.text).toBe("Uses about 18.4 kWh a day (about S$5.52)");
    expect(page.host.querySelector("#story-title")?.textContent).toBe(report.averageDay!.text);
    // What the dates cost in all follows it.
    expect(page.text()).toContain("Estate spent S$55 on electricity in 10 days.");
    await page.unmount();
  });

  it("splits by group with the report's breakdown, the same numbers as the Overview", async () => {
    const page = await render(summary());
    const money = section(page.host, "story-money");
    // Block A 124 of 184 kWh (67%, 12.4 kWh a day); the common area 60 (33%, 6 kWh a day).
    expect(report.groups!.breakdown.map(row => [row.name, row.pct])).toEqual([["Block A", 67], ["Common area", 33]]);
    const line = (row: Element) => [...row.querySelectorAll("span")].map(part => part.textContent).filter(Boolean);
    expect([...money.querySelectorAll("section > ul > li")].map(item => line(item.firstElementChild!))).toEqual([["Block A", "12.4 kWh a day · 67%"], ["Common area", "6.0 kWh a day · 33%"]]);
    // A group opens onto what is inside it, adding up to the group's share.
    const block = money.querySelector<HTMLButtonElement>("section > ul > li > button")!;
    const inside = money.querySelector<HTMLElement>('[aria-label="Inside Block A"]')!;
    expect(inside.hidden).toBe(true);
    await act(async () => block.click());
    expect(block.getAttribute("aria-expanded")).toBe("true");
    expect(inside.hidden).toBe(false);
    expect(line(inside.querySelector("li > div")!)).toEqual(["Lobby lights", "12.4 kWh a day · 67%"]);
    expect(money.textContent).toContain("Block A accounts for 67% of the bill.");
    await page.unmount();
  });

  it("names the lights on in the daytime, and when, in the report's words", async () => {
    const page = await render(summary());
    const on = section(page.host, "story-on");
    expect(report.daytime!.items).toEqual(["Lobby lights: on 10 am – 2 pm on 1 day, 4.0 kWh"]);
    expect(on.querySelector("h3")?.textContent).toBe("On in the daytime");
    expect([...on.querySelectorAll("li")].map(item => item.textContent)).toEqual(report.daytime!.items);
    expect(on.textContent).toContain(report.daytime!.rule);
    // The list is in step 2 now, not in the summary at the top.
    expect(page.host.querySelector("section[aria-labelledby='story-title']")?.textContent).not.toContain("Lobby lights");
    await page.unmount();
  });

  it("shows a lights-on site's average day hour by hour from every complete day, as the report does", async () => {
    const page = await render(summary());
    const when = section(page.host, "story-when");
    expect(when.querySelector("h2")?.textContent).toBe("An average day, hour by hour");
    expect([...when.querySelectorAll('[role="group"] button')].map(button => button.textContent)).toEqual(["Average day", "Single day"]);
    expect(when.querySelector("h3")?.textContent).toBe("Average of 10 complete days");
    // The bars add up to the report's average day: 18.4 kWh, shown rounded.
    expect(when.textContent).toContain("18 kWh a day:");
    // The report's own reading of when the lights come on and go off.
    expect(when.textContent).toContain(bold(report.pattern!.intro));
    await page.unmount();
  });

  it("lists the days that stood out as the report does, and opens one hour by hour", async () => {
    const page = await render(summary());
    const days = section(page.host, "story-days");
    expect(report.standout.items.map(item => item.date)).toEqual([ODD_DAY]);
    expect(days.querySelector("h2")?.textContent).toBe("Days that stood out");
    expect(days.querySelector("li p")?.textContent).toBe(report.standout.items[0]!.text);
    expect(days.textContent).toContain(report.standout.rule);
    const open = days.querySelector<HTMLButtonElement>('button[aria-label="Open Thu 5 Nov 2026 hour by hour"]')!;
    await act(async () => open.click());
    const when = section(page.host, "story-when");
    expect(when.querySelector("h3")?.textContent).toBe("Thu 5 Nov 2026 hour by hour");
    expect(when.querySelector('[role="group"] button[aria-pressed="true"]')?.textContent).toBe("Single day");
    await page.unmount();
  });

  it("words the new steps in Chinese and Malay", async () => {
    const zh = await render(summary(), "zh-Hans");
    for (const words of ["4 · 与平常不同的日子", "3 · 平均一天", "平均一天的逐小时用电", "平均每天", "10 个完整日子的平均", "白天亮着的灯", "按分组", "与概览页相同"]) expect(zh.text()).toContain(words);
    expect(zh.host.querySelector("#story-title")?.textContent).toBe(buildSiteReport(DATA, null, "2026-11-12T00:00:00.000Z", "zh-Hans").averageDay!.text);
    await zh.unmount();
    const ms = await render(summary(), "ms");
    for (const words of ["4 · Hari yang menonjol", "Hari biasa, jam demi jam", "Purata sehari", "Purata 10 hari lengkap", "Menyala pada waktu siang", "Lihat hari itu mengikut jam"]) expect(ms.text()).toContain(words);
    await ms.unmount();
  });

  it("keeps the weekday and weekend averages for opening hours, from the days the report counts as complete", async () => {
    const hours = { from: "09:00", to: "18:00" };
    const office: AnalysisData = { ...DATA, projectName: "Office", groups: undefined, hoursMeaning: "opening", openingHours: { monday: [hours], tuesday: [hours], wednesday: [hours], thursday: [hours], friday: [hours] } };
    const page = await render(summary(office));
    const when = section(page.host, "story-when");
    expect([...when.querySelectorAll('[role="group"] button')].map(button => button.textContent)).toEqual(["Weekday average", "Weekend average", "Single day"]);
    expect(when.querySelector("h2")?.textContent).toBe("When the energy is used");
    // No daytime list for opening hours: the report has none either.
    expect(section(page.host, "story-on").querySelector("h3")).toBeNull();
    await page.unmount();
  });
});
