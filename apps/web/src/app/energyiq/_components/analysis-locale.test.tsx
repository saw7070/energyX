/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisData, ScopeData, TrendCell } from "./analysis-data";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: mock.load }));

import { AnalysisView } from "./analysis-view";
import { DecisionSummary } from "./analysis-story";
import { closedUseBreakdown, dateWithDay, dateWithDayYear, savingsPlan, scopeDays, shortDate, weekdayShort } from "./analysis-model";
import { holidayName, listText, tariffNote } from "./analysis-messages";
import { describePickerDay } from "./day-picker";
import { circuitSlices } from "./peak-share-donut";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";

// One week (Mon 10 – Sun 16 Aug): 2 kW always on, 6 kW while open 09:00–18:00, and a 1 kW TV left on day and night.
const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0;
const series = (id: string, kwhAt: (date: string, hour: number) => number) => ({ id, expectedMinutesPerHour: 60, cells: dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwhAt(date, hour), 60, 0] as TrendCell)) });
const siteKwh = (date: string, hour: number) => weekday(date) && hour >= 9 && hour < 18 ? 6 : 2;
const scope = (id: string, name: string, extra: Partial<ScopeData> = {}): ScopeData => ({
  id, name, dates, timezone: "Asia/Singapore", total: series("__scope__", siteKwh), types: { load: series("__category__:load", siteKwh) }, meters: [],
  usageKwh: 0, peakKw: 6, peakAt: null, cost: null, typeTotals: { load: 0 }, coverage: 100, ...extra,
});
const usage = 516; // 5 weekdays × (9 h × 6 + 15 h × 2) + 2 weekend days × 24 h × 2
const project = scope("project", "Office", { usageKwh: usage, typeTotals: { load: usage }, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax", rates: [0.3], basis: "tax_exclusive" } });
const space = scope("l1", "Level 1", { usageKwh: usage, meters: [
  { id: "db", name: "DB1 Power", location: "Level 1", category: "load", official: true, series: series("db", siteKwh) },
  { id: "tv", name: "Lobby TV", location: "Level 1", category: "load", official: false, series: series("tv", () => 1) },
] });
const hours = { from: "09:00", to: "18:00" };
const data: AnalysisData = {
  projectId: "office", projectName: "Office", timezone: "Asia/Singapore", snapshotId: "snap", current: { project, spaces: [space] }, previous: null, history: null,
  circuits: [], holidays: new Map(), openingHours: { monday: [hours], tuesday: [hours], wednesday: [hours], thursday: [hours], friday: [hours] }, actions: [],
};

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(locale: EnergyIqLocale, node: ReactNode) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Charts have no size in this test DOM; only their wording around them matters here.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => host.textContent ?? "", unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("Analysis wording helpers in other languages", () => {
  it("writes dates the reader's way and keeps English unchanged", () => {
    expect([shortDate("2026-09-05"), dateWithDay("2026-09-05"), dateWithDayYear("2026-09-05"), weekdayShort("2026-09-05")]).toEqual(["5 Sep", "Sat 5 Sep", "Sat 5 Sep 2026", "Sat"]);
    expect([shortDate("2026-09-05", "zh-Hans"), dateWithDay("2026-09-05", "zh-Hans"), dateWithDayYear("2026-09-05", "zh-Hans"), weekdayShort("2026-09-05", "zh-Hans")]).toEqual(["9月5日", "9月5日 周六", "2026年9月5日 周六", "周六"]);
    expect([shortDate("2026-08-05", "ms"), dateWithDay("2026-08-05", "ms"), weekdayShort("2026-08-05", "ms")]).toEqual(["5 Ogo", "Rab 5 Ogo", "Rab"]);
    expect(listText(["A", "B", "C"], "zh-Hans")).toBe("A、B和C");
    expect(listText(["A", "B"], "ms")).toBe("A dan B");
  });

  it("words the savings plan, closures, tariffs, picker days and donut slices in Chinese and Malay", () => {
    const row = { id: "tv", name: "Lobby TV", space: "L2", category: "load" as const, kind: "circuit" as const, totalKwh: 100, closedKwh: 50, closedHours: 50, closedKw: 1, essential: false, lowestKw: 0.2, aboveLowestKwh: 28 };
    const input = { projectName: "Campus", closedUse: [row], closedHoursPerYear: 6000, rate: 0.3, currency: "SGD", aboveBenchmarkKwh: null, benchmarkKw: null, periodDays: 28,
      anomalies: [{ date: "2026-08-12", dayType: "weekday" as const, totalKwh: 300, expectedKwh: 250, deltaPct: 20 }], actions: [] };
    const [zh, zhUnusual] = savingsPlan(input, "zh-Hans");
    expect(zh).toMatchObject({ title: "非营业时间关闭 Lobby TV", area: "Lobby TV（L2）", math: "1.00 kW × 每年 6,000 个非营业小时 × SGD 0.3000/kWh", confidence: "Medium", annualKwh: 6000 });
    expect(zh!.detail).toBe("非营业时间平均功率为 1.00 kW，它有 50% 的用电发生在非营业时间。在用电最少的夜晚，它已经能降到 0.20 kW。");
    expect(zhUnusual).toMatchObject({ title: "查明 1 个异常日发生了什么", detail: "8月12日（+20%）的用电比同类型的正常日子高出 15% 以上。" });
    const [ms] = savingsPlan(input, "ms");
    expect(ms).toMatchObject({ title: "Matikan Lobby TV selepas waktu bekerja", math: "1.00 kW × 6,000 jam setahun selepas waktu bekerja × SGD 0.3000/kWh" });
    expect(savingsPlan(input)[0]!.title).toBe("Switch off Lobby TV after working hours");

    const byType = closedUseBreakdown(project, [], new Map(), data.openingHours, "zh-Hans");
    expect(byType[0]!.name).toBe("插座与设备用电");

    expect(holidayName("Office move (planned closure)")).toBe("Office move (planned closure)");
    expect(holidayName("Office move (planned closure)", "zh-Hans")).toBe("Office move（计划停业）");
    expect(holidayName("Office move (planned closure)", "ms")).toBe("Office move (penutupan terancang)");
    expect(tariffNote(project.cost!)).toBe("0.3 SGD/kWh before tax");
    expect(tariffNote(project.cost!, "zh-Hans")).toBe("0.3 SGD/kWh（未含税）");
    expect(tariffNote(project.cost!, "ms")).toBe("0.3 SGD/kWh sebelum cukai");

    const holiday = { date: "2026-08-10", dayType: "public_holiday" as const, holidayName: "National Day observed", complete: false, totalKwh: 42 };
    expect(describePickerDay(holiday, "zh-Hans")).toBe("2026年8月10日 周一，National Day observed、部分读数缺失，42 kWh");
    expect(describePickerDay(holiday, "ms")).toBe("Isn 10 Ogo 2026, National Day observed, sebahagian bacaan hilang, 42 kWh");

    const slices = circuitSlices([{ id: "a", name: "A", kwh: 1, periodKwh: 9 }, { id: "b", name: "B", kwh: 1, periodKwh: 8 }, { id: "c", name: "C", kwh: 1, periodKwh: 7 }, { id: "d", name: "D", kwh: 1, periodKwh: 6 }, { id: "e", name: "E", kwh: 1, periodKwh: 5 }, { id: "f", name: "F", kwh: 1, periodKwh: 4 }], 10, "zh-Hans");
    expect(slices.slice(-2).map(slice => [slice.name, slice.detail])).toEqual([["其他线路（2）", "E、F"], ["未按线路细分", "由这个区域的总表计量，但没有线路电表显示这部分电用在了哪里"]]);
  });
});

describe("Analysis page in other languages", () => {
  it("tells the decision summary in Chinese, with the money in the right place in each sentence", async () => {
    const page = await render("zh-Hans", <DecisionSummary data={data} days={scopeDays(project, data.holidays)} anomalies={[]} floor={null} rate={0.3} />);
    // 246 kWh of 516 was used while closed: SGD 74 of SGD 155.
    expect(page.text()).toContain("Office在 7 天内花了 S$155 电费，其中 S$74 (48%) 用在非营业时间。");
    for (const text of ["简要结论", "1 · 钱花在哪里", "按区域", "按用电类型", "营业时间为 09:00–18:00。", "非营业时间关闭 Lobby TV", "每年 6,414 个非营业小时 × SGD 0.30/kWh", "健康检查", "节省计划", "单日", "核实事项——不计入总数"]) expect(page.text()).toContain(text);
    expect(page.host.querySelector('[aria-label="“插座与设备用电”是什么意思？"]')).not.toBeNull();
    expect(page.host.querySelector('nav[aria-label="本页内容"]')).not.toBeNull();
    expect(page.text()).not.toMatch(/Where the money goes|after working hours|Savings plan/);
    await page.unmount();
  });

  it("shows the page frame, date controls and detailed analysis in Malay and Chinese", async () => {
    mock.load.mockResolvedValue(data);
    const ms = await render("ms", <AnalysisView projectId="office" />);
    expect(ms.host.querySelector("h1")?.textContent).toBe("Analisis");
    for (const text of ["Gambaran keseluruhan / Analisis", "4 minggu terkini", "Guna", "Office membelanjakan S$155 untuk elektrik dalam 7 hari.", "Ke mana wang dibelanjakan", "Analisis terperinci", "Ringkasan eksekutif", "Trend jumlah harian", "Sorotan utama"]) expect(ms.text()).toContain(text);
    expect(ms.host.querySelector('input[aria-label="Dari"]')).not.toBeNull();
    await ms.unmount();

    const zh = await render("zh-Hans", <AnalysisView projectId="office" />);
    expect(zh.host.querySelector("h1")?.textContent).toBe("用电分析");
    for (const text of ["概览 / 用电分析", "最近 4 周", "应用", "2026年8月10日–16日", "详细分析", "执行摘要", "每日总用电趋势", "重点数据", "电价：0.3 SGD/kWh（未含税）。", "发现摘要", "工作日、周末和假期", "用电最多的线路"]) expect(zh.text()).toContain(text);
    expect(zh.host.querySelector('form[aria-label="日期"]')).not.toBeNull();
    await zh.unmount();
  });
});
