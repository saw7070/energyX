/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { explainDays, meterGroupPlaces, scopeDays, standoutMeters } from "@datafoundry/site-report";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: mock.load }));

import { AnalysisView } from "./analysis-view";
import { DayTip, StandoutDayList } from "./analysis-standout";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import { DATA, GAP_DAY, site, THURSDAY } from "./standout-days.test-fixture";

const explained = explainDays({ days: scopeDays(site, DATA.holidays), meters: standoutMeters([site]), lighting: true, places: meterGroupPlaces(DATA.groups) });
const on = (date: string) => explained.find(item => item.date === date)!;
const totalLabel = (kwh: string, whole: boolean) => `Daily Total: ${kwh}${whole ? "" : " (missing readings)"}`;

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); vi.restoreAllMocks(); mock.load.mockReset(); });

async function render(locale: EnergyIqLocale, node: ReactNode) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Charts have no size in this test DOM; only the wording around them matters here.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => host.textContent ?? "", unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("why a day was different, on the Analysis daily chart", () => {
  it("explains a bar that stood out in its tooltip, naming the meters and their groups", async () => {
    const page = await render("en", <DayTip date={THURSDAY} item={on(THURSDAY)} siteName="SKTC" totalLabel={totalLabel} />);
    expect(page.host.querySelector("p")?.textContent).toBe("Thu 5 Nov");
    expect(page.text()).toContain("Thu 5 Nov used 48.4 kWh, 2.3 kWh more than a usual day (46.1 kWh).");
    expect(page.text()).toContain("Most of the extra:");
    const items = [...page.host.querySelectorAll("li")].map(item => [...item.children].map(child => child.textContent));
    expect(items).toEqual([["Compassvale Bow entrance", "Common area", "+1.5 kWh"], ["Pavilion DL & fan", "Common area › Pavilion", "+0.6 kWh"]]);
    expect(page.host.querySelector("li small")?.className).toContain("text-[11px]");
    await page.unmount();
  });

  it("says readings were missing instead of blaming a meter", async () => {
    const page = await render("en", <DayTip date={GAP_DAY} item={on(GAP_DAY)} siteName="SKTC" totalLabel={totalLabel} />);
    expect(page.text()).toContain("Daily Total: 46.1 kWh (missing readings)");
    expect(page.text()).toContain("Readings were missing on this day, so it is not compared with a usual day.");
    expect(page.host.querySelector("li")).toBeNull();
    await page.unmount();
  });

  it("lists the same explanations under the chart, with the rule, so they can be read without hovering", async () => {
    const page = await render("en", <StandoutDayList items={explained} lighting siteName="SKTC" hint="Outlined bars stood out. Hover over or tap a bar to see why." />);
    const section = page.host.querySelector("section")!;
    expect(section.getAttribute("aria-labelledby")).toBe(section.querySelector("h3")!.id);
    expect(section.querySelector("h3")?.textContent).toBe("Days that stood out");
    expect(page.text()).toContain("A day is called out when it differs from a usual day (the middle value of complete days in these dates) by more than 3% and by more than twice the normal day-to-day variation.");
    expect([...section.querySelector("ul")!.children].map(item => item.querySelector("p")?.textContent)).toEqual(["Thu 5 Nov used 48.4 kWh, 2.3 kWh more than a usual day (46.1 kWh)."]);
    await page.unmount();

    const quiet = await render("ms", <StandoutDayList items={explained.filter(item => item.date !== THURSDAY)} lighting siteName="SKTC" hint="" />);
    expect(quiet.text()).toContain("Hari yang menonjol");
    expect(quiet.text()).toContain("Tiada hari yang menonjol berbanding hari biasa.");
    await quiet.unmount();
  });

  it("shows a lights-on site's days as one kind on the Analysis page, in English and Chinese", async () => {
    mock.load.mockResolvedValue(DATA);
    const en = await render("en", <AnalysisView projectId="sktc" />);
    expect(en.text()).toContain("Daily total · kWh · every day");
    expect(en.text()).toContain("Days that stood out");
    expect(en.text()).toContain("Thu 5 Nov used 48.4 kWh, 2.3 kWh more than a usual day (46.1 kWh).");
    // No weekday / weekend switch on the daily chart: the lights run every night.
    const trend = [...en.host.querySelectorAll("section")].find(section => section.querySelector("button")?.textContent === "Daily Total Trend")!;
    expect(trend.textContent).toContain("Days that stood out");
    expect(trend.querySelector('[role="group"][aria-label="Kind of day"]')).toBeNull();
    // The chart's usual-day line is the same 46.1 kWh the explanations compare with: one usual figure on the page.
    expect(trend.textContent).toContain("13 complete days · usual day: 46.1 kWh per day.");
    expect(trend.textContent).toContain("Unusual days: 0 of 13 complete days");
    await en.unmount();

    const zh = await render("zh-Hans", <AnalysisView projectId="sktc" />);
    expect(zh.text()).toContain("与平常不同的日子");
    expect(zh.text()).toContain("11月5日 周四用电 48.4 kWh，比正常日子（46.1 kWh）多 2.3 kWh。");
    expect(zh.text()).toContain("正常日子：46.1 kWh");
    expect(zh.text()).toContain("每日总用电 · kWh · 每一天");
    await zh.unmount();
  });
});
