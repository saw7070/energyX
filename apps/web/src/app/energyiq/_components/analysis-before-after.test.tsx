/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shiftScopeDate, type SiteChange } from "@datafoundry/site-report";
import type { AnalysisData, ScopeData, TrendCell } from "./analysis-data";
import { DecisionSummary } from "./analysis-story";
import { beforeAfterViewMessages } from "./analysis-before-after-messages";
import { scopeDays } from "./analysis-model";
import { storyMessages } from "./analysis-story-messages";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";

vi.mock("../../../lib/config-api", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../lib/config-api")>();
  return { ...actual, configApi: { ...actual.configApi, getEnergyOperationalPolicies: () => new Promise(() => undefined) } };
});

// Sample data shaped like a lit estate: about 47 kWh of lighting a night (19:00–07:00), 0.05 kWh an hour by day, over
// 28 days from Tue 3 Nov with the four weeks before. Night use is 30% lower from the night of `dimFrom`.
const first = "2026-11-03";
const datesFrom = (start: string, count: number) => Array.from({ length: count }, (_, index) => shiftScopeDate(start, index));
const night = (hour: number) => hour < 7 || hour >= 19;
function estate(dimFrom: string | null, changes: SiteChange[]): AnalysisData {
  const kwh = (date: string, hour: number) => night(hour) ? 47 / 12 * (dimFrom && date >= dimFrom ? 0.7 : 1) : 0.05;
  const scope = (dates: string[]): ScopeData => {
    const cells = dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendCell));
    const usage = cells.reduce((sum, cell) => sum + cell[2]!, 0);
    return { id: "project", name: "Estate", dates, timezone: "Asia/Singapore", total: { id: "__scope__", expectedMinutesPerHour: 60, cells }, types: {}, meters: [],
      usageKwh: usage, peakKw: null, peakAt: null, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax", rates: [0.3], basis: "tax_exclusive" }, typeTotals: { light: usage }, coverage: 100 };
  };
  const nightly = [{ from: "19:00", to: "07:00" }];
  return {
    projectId: "estate", projectName: "Sample Estate", timezone: "Asia/Singapore", snapshotId: null,
    current: { project: scope(datesFrom(first, 28)), spaces: [] }, previous: { project: scope(datesFrom("2026-10-06", 28)), spaces: [] }, history: null, circuits: [],
    holidays: new Map(), openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, nightly])), hoursMeaning: "lights_on", actions: [],
    tariffTax: { name: "GST", ratePct: 9 }, carbon: { kgCo2ePerKwh: 0.402, year: 2024, source: "EMA" }, ...(changes.length ? { changes } : {}),
  };
}
const DIMMING: SiteChange = { id: "dim", title: "Smart lighting: 30% night dimming", date: "2026-11-17", meterIds: [], note: "Installed by Charles" };

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

async function render(data: AnalysisData, locale: EnergyIqLocale = "en") {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Charts have no size in this test DOM; the words, the table and the links around them are what is checked.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const node: ReactNode = <EnergyIqLocaleProvider><DecisionSummary data={data} days={scopeDays(data.current.project, data.holidays)} anomalies={[]} floor={null} rate={0.3} /></EnergyIqLocaleProvider>;
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
  const step = () => host.querySelector("#story-change");
  const nav = () => Array.from(host.querySelectorAll("nav button")).map(button => button.textContent);
  return { host, step, nav, unmount: () => act(async () => root.unmount()) };
}

describe("Analysis: before and after a change", () => {
  it("leads the page with the change: the takeaway, a table of before, after and change, and how sure it is", async () => {
    const view = await render(estate("2026-11-17", [DIMMING]));
    expect(view.nav()[0]).toBe("Before and after");
    const step = view.step()!;
    expect(step).not.toBeNull();
    const text = step.textContent ?? "";
    expect(text).toContain("Since 17 Nov, night use is 30% lower: about 14 kWh a day, S$138 a month.");
    expect(text).toContain("Smart lighting: 30% night dimming");
    expect(text).toContain("Started Tue 17 Nov 2026 · Whole site");
    expect(text).toContain("Installed by Charles");
    expect(text).toContain("Night use each day");
    // The table: an average day, a month and a year, before, after and the change, in kWh and money incl. GST.
    const rows = Array.from(step.querySelectorAll("tr[data-period]")).map(row => Array.from(row.querySelectorAll("th, td")).map(cell => cell.textContent));
    expect(rows[0]).toEqual(["A day", "47.0 kWhS$15.37", "32.9 kWhS$10.76", "−14.1 kWh−S$4.61−30%"]);
    expect(rows[1]).toEqual(["A month (30 days)", "1,410 kWhS$461", "987 kWhS$323", "−423 kWh−S$138"]);
    expect(rows[2]![0]).toBe("A year");
    expect(rows[2]![3]).toBe("−5,147 kWh−S$1,683");
    expect(text).toContain("Carbon: about 2.1 t CO2e less a year, at 0.402 kg CO2e per kWh.");
    expect(text).toContain("Costs at S$0.3270 per kWh, including GST.");
    expect(text).toContain("Reliable: 13 complete days since the change, against 28 before it.");
    expect(text).toContain("Before: 28 complete days, 20 Oct – 16 Nov 2026. After: 13 complete days, 18–30 Nov 2026.");
    expect(text).toContain("only the lights-on hours (19:00 → 07:00 next day)");
    expect(step.querySelector('a[href="/energyiq/project-configuration?projectId=estate&tab=savings"]')).not.toBeNull();
    await view.unmount();
  });

  it("says a figure from few days after the change is early", async () => {
    const view = await render(estate("2026-11-26", [{ ...DIMMING, date: "2026-11-26" }]));
    const text = view.step()!.textContent ?? "";
    expect(text).toContain("Since 26 Nov, night use is 30% lower");
    expect(text).toContain("Early figure: 4 complete days since the change. It is called reliable from 7 days.");
    await view.unmount();
  });

  it("waits for three complete days, saying the change is recorded and what it starts from", async () => {
    const view = await render(estate(null, [{ ...DIMMING, title: "Smart lighting", date: "2026-12-01" }]));
    const text = view.step()!.textContent ?? "";
    expect(text).toContain("Recorded: Smart lighting starts 1 Dec. The comparison appears after 3 complete days.");
    expect(text).toContain("Starts Tue 1 Dec 2026");
    expect(text).toContain("Before the change, night use averaged 47 kWh a day over 28 complete days.");
    expect(view.step()!.querySelector("table")).toBeNull();
    await view.unmount();
  });

  it("is not on the page without a change in or before the chosen dates", async () => {
    const none = await render(estate(null, []));
    expect(none.step()).toBeNull();
    expect(none.nav()).not.toContain("Before and after");
    await none.unmount();
    // A change after dates picked from the past (newer readings exist) is not shown.
    const past = estate(null, [{ ...DIMMING, date: "2026-12-10" }]);
    const later = await render({ ...past, history: { ...past.current.project, dates: datesFrom("2026-06-01", 200) } });
    expect(later.step()).toBeNull();
    await later.unmount();
  });

  it("speaks Chinese and Malay, with every sentence in every language", async () => {
    const zh = await render(estate("2026-11-17", [DIMMING]), "zh-Hans");
    expect(zh.nav()[0]).toBe("改动前后对比");
    expect(zh.step()!.textContent).toContain("自11月17日起，夜间用电降低了 30%：每天约少 14 kWh，每月约省 S$138。");
    expect(zh.step()!.textContent).toContain("每天夜间用电");
    await zh.unmount();
    const ms = await render(estate("2026-11-17", [DIMMING]), "ms");
    expect(ms.nav()[0]).toBe("Sebelum dan selepas");
    expect(ms.step()!.textContent).toContain("Sejak 17 Nov, penggunaan waktu malam 30% lebih rendah");
    await ms.unmount();
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const book of [beforeAfterViewMessages, storyMessages] as Array<Record<EnergyIqLocale, Record<string, string>>>) {
      const keys = Object.keys(book.en).sort();
      for (const locale of ["zh-Hans", "ms"] as const) {
        expect(Object.keys(book[locale]).sort()).toEqual(keys);
        for (const key of keys) {
          expect(book[locale][key]?.trim(), `${key} (${locale})`).toBeTruthy();
          expect(placeholders(book[locale][key]!), `${key} (${locale})`).toEqual(placeholders(book.en[key]!));
        }
      }
    }
  });
});
