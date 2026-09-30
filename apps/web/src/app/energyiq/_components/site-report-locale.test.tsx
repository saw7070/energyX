/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-data";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: mock.load }));

import { serializeSiteReportSnapshot } from "@datafoundry/site-report";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider, useEnergyIqLocale } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import { buildSiteReport, clock, dateRuns, hourBetween, hourRange, weekdayOf } from "./site-report-model";
import { plainNames, plainTimes, SiteReportPanel, standaloneReportHtml, useSiteReport } from "./site-report";
import { areaLabel, BoardLegend, propertySummary, SiteFloorMap } from "./site-floor-map";

// The Tuya Office fixture of site-report-model.test.ts: two weeks from Monday 3 Aug 2026, open Monday–Friday 09:00–18:00.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const open = (date: string, hour: number) => !weekend(date) && hour >= 9 && hour < 18;
type Profile = (date: string, hour: number) => number;
const series = (id: string, kwh: Profile): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])) });
const PROFILES: Record<string, { name: string; board: string; category: ScopeMeter["category"]; kwh: Profile }> = {
  "db1-light": { name: "DB1 L1 Light", board: "DB1", category: "light", kwh: (date, hour) => open(date, hour) ? (hour === 12 || hour === 13 ? 1.4 : 2) : !weekend(date) && (hour === 18 || hour === 19) ? 1.2 : 0.05 },
  "db1-power": { name: "DB1 L1 Power", board: "DB1", category: "load", kwh: (date, hour) => open(date, hour) ? 0.4 : 0.3 },
  "db2-power": { name: "DB2 L2 Power", board: "DB2", category: "load", kwh: (date, hour) => open(date, hour) ? 1.95 : 1.9 },
  "led-1": { name: "LED Display 1", board: "DB3", category: "other", kwh: () => 0.19 },
  "led-2": { name: "LED Display 2", board: "DB3", category: "other", kwh: () => 0.19 },
  "led-3": { name: "LED Display 3", board: "DB3", category: "other", kwh: () => 0.19 },
};
const meter = (id: string): ScopeMeter => ({ id, name: PROFILES[id]!.name, location: PROFILES[id]!.board, category: PROFILES[id]!.category, official: true, series: series(id, PROFILES[id]!.kwh) });
function scope(name: string, ids: string[]): ScopeData {
  const total = series("__scope__", (date, hour) => ids.reduce((sum, id) => sum + PROFILES[id]!.kwh(date, hour), 0));
  const usage = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
  return { id: name, name, dates: DATES, timezone: "Asia/Singapore", total, types: {}, meters: ids.map(meter), usageKwh: usage, peakKw: null, peakAt: null,
    cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100 };
}
const IDS = Object.keys(PROFILES);
const DATA: AnalysisData = {
  projectId: "tuya-office", projectName: "Tuya Office", timezone: "Asia/Singapore", snapshotId: null,
  current: { project: scope("Tuya Office", IDS), spaces: [scope("Space 1 - Office Area", ["db1-light", "db1-power"]), scope("Space 2 - Shared Area", ["db2-power", "led-1", "led-2", "led-3"])] },
  previous: null, history: null, circuits: [], holidays: new Map(), openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])), actions: [],
};
const REFERENCE = {
  schemaVersion: 1, projectId: "tuya-office", provenance: { file: "reference.html", status: "reference-derived" },
  property: { address: "6 Battery Road, Singapore", level: 27, occupancyExtent: "half floor", approximateAreaM2: 700 },
  layout: {
    viewBox: [0, 0, 860, 508], entrance: { label: "Main entrance gate", referenceBoard: "DB1", position: [430, 420] }, boardMarkers: { DB1: [478, 330], DB2: [86, 238], DB3: [32, 238] },
    zones: [
      { id: "A", referenceBoard: "DB1", directionFromEntrance: "right", rooms: ["Open office", "Director room"], rect: [470, 20, 366, 396] },
      { id: "B", referenceBoard: "DB2", directionFromEntrance: "left", rooms: ["Showroom", "Pantry"], rect: [24, 20, 366, 396] },
      { id: "C", referenceBoard: "DB3", independentSpace: false, physicalParentRoom: "Showroom", equipment: "Three large LED panels" },
    ],
    rooms: [{ name: "Showroom", zone: "B", rect: [32, 70, 210, 150] }, { name: "Pantry", zone: "B", rect: [250, 70, 132, 70] }, { name: "Open office", zone: "A", rect: [478, 70, 166, 240] }, { name: "Director room", zone: "A", rect: [652, 218, 176, 92] }],
  },
} as unknown as ProjectSpatialReference;
const GENERATED = "2026-09-22T10:00:00Z";

/** Every sentence-like string in a report, for checking that no English wording is left. */
function prose(report: ReturnType<typeof buildSiteReport>): string[] {
  const { masthead, title, lede, headline, keyFigures, profile, estimate, benchmark, pattern, screening, footer, circuits } = report;
  return [masthead.detail, masthead.period, masthead.periodNote, title.before, title.emphasis, lede, headline, ...keyFigures.map(figure => figure.label), profile.intro, ...profile.zones.flatMap(zone => [zone.heading, zone.text]), profile.caption,
    estimate.intro, estimate.comparison, estimate.spaceCaption, estimate.loadCaption, estimate.note, benchmark.intro, benchmark.caption, benchmark.outro, ...benchmark.rows.flatMap(row => [row.label, row.rate, row.cost]),
    pattern!.intro, pattern!.cause!, pattern!.caption, ...pattern!.notes.map(note => note.text), screening.intro, screening.callout, screening.note, ...screening.rows.flatMap(row => [row.open, row.finding]),
    footer.left, footer.right, ...circuits.flatMap(circuit => [circuit.name, circuit.label]), ...report.benchmark.days.map(day => day.dow)];
}
// Names from the project (areas, rooms, meters, address) and units stay as written; any other English word is a missed translation.
// Zone and board ids (A, DB1, L1), units (kWh, kW, m², h, S$) and the time zone are not translated either.
const DATA_WORDS = new Set(["Tuya", "Office", "Area", "Shared", "LED", "Display", "Battery", "Road", "Showroom", "Pantry", "Open", "office", "Director", "room", "Three", "large", "panels", "Main", "entrance", "gate", "half", "floor", "Light", "Power",
  "A", "B", "C", "DB", "L", "kWh", "kW", "m", "h", "S", "SGT", "GST", "EnergyX"]);
const englishLeft = (texts: string[]) => [...new Set(texts.flatMap(text => text.match(/[A-Za-z]+/g) ?? []))].filter(word => !DATA_WORDS.has(word));
/** Each piece of text a reader sees, one text node at a time (the page's CSS excluded). */
function visibleTexts(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), out: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.parentElement?.tagName !== "STYLE") out.push(node.textContent ?? "");
  return out;
}

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); vi.restoreAllMocks(); mock.load.mockReset(); });

async function render(locale: EnergyIqLocale, node: ReactNode) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => host.textContent ?? "", unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("site report wording helpers in other languages", () => {
  it("says times, hour ranges, dates and weekdays the reader's way, and keeps English unchanged", () => {
    expect([clock(9, "zh-Hans"), clock(12, "zh-Hans"), clock(13, "zh-Hans"), clock(20, "zh-Hans"), clock(24, "zh-Hans"), clock(3, "zh-Hans")]).toEqual(["上午9点", "中午12点", "下午1点", "晚上8点", "午夜12点", "凌晨3点"]);
    expect([clock(9, "ms"), clock(12, "ms"), clock(15, "ms"), clock(20, "ms"), clock(0, "ms")]).toEqual(["9 pagi", "12 tengah hari", "3 petang", "8 malam", "12 tengah malam"]);
    expect([hourRange(9, 18, "zh-Hans"), hourRange(9, 11, "zh-Hans"), hourRange(9, 18, "ms"), hourRange(9, 11, "ms")]).toEqual(["上午9点–下午6点", "上午9–11点", "9 pagi – 6 petang", "9–11 pagi"]);
    expect([hourBetween(9, 10, "zh-Hans"), hourBetween(11, 13, "zh-Hans"), hourBetween(9, 10, "ms")]).toEqual(["上午9点到10点", "上午11点到下午1点", "9 dan 10 pagi"]);
    expect(dateRuns(["2026-08-18", "2026-08-19", "2026-08-27", "2026-08-31", "2026-09-01"], "zh-Hans")).toEqual(["8月18–19日", "8月27日", "8月31日 – 9月1日"]);
    expect(dateRuns(["2026-08-18", "2026-08-19", "2026-08-27"], "ms")).toEqual(["18–19 Ogo", "27 Ogo"]);
    expect([weekdayOf("2026-08-03"), weekdayOf("2026-08-03", "zh-Hans"), weekdayOf("2026-08-03", "ms")]).toEqual(["Mon", "周一", "Isn"]);
    expect([clock(20), hourRange(9, 18), hourBetween(9, 10)]).toEqual(["8 pm", "9 am – 6 pm", "9 and 10 am"]);
    expect(plainTimes("Check a 20:00 rule for 09:00–18:00 blocks")).toBe("Check an 8 pm rule for 9 am–6 pm blocks");
    expect(plainTimes("20:00 之后关闭 09:00", "zh-Hans")).toBe("晚上8点 之后关闭 上午9点");
    expect(plainTimes("Matikan pada 20:00", "ms")).toBe("Matikan pada 8 malam");
    expect([areaLabel("A"), areaLabel("A", "zh-Hans"), areaLabel("A", "ms"), areaLabel("Office wing", "zh-Hans")]).toEqual(["Area A", "区域 A", "Kawasan A", "Office wing"]);
    expect(propertySummary(REFERENCE, "zh-Hans")).toBe("6 Battery Road, Singapore · 27 楼 · half floor · 约 700 m²");
    expect(propertySummary(REFERENCE, "ms")).toBe("6 Battery Road, Singapore · Aras 27 · half floor · kira-kira 700 m²");
  });
});

describe("site report in Chinese and Malay", () => {
  const english = buildSiteReport(DATA, REFERENCE, GENERATED);
  const chinese = buildSiteReport(DATA, REFERENCE, GENERATED, "zh-Hans");
  const malay = buildSiteReport(DATA, REFERENCE, GENERATED, "ms");
  const circuit = (report: typeof english, code: string) => report.circuits.find(item => item.code === code)!;

  it("keeps the figures and the language-independent headline topic the same in every language", () => {
    expect([english.locale, chinese.locale, malay.locale]).toEqual(["en", "zh-Hans", "ms"]);
    expect([english.headlineTopic, chinese.headlineTopic, malay.headlineTopic]).toEqual(["always-on", "always-on", "always-on"]);
    expect(chinese.estimate.monthKwh).toBe(english.estimate.monthKwh);
    expect(chinese.circuits.map(item => [item.code, item.monthKwh, item.colour])).toEqual(english.circuits.map(item => [item.code, item.monthKwh, item.colour]));
    expect(chinese.siteWord).toBe("office");
  });

  it("writes the Chinese report in whole Chinese sentences", () => {
    expect(chinese.title).toEqual({ before: "超过五分之四的办公室用电", emphasis: "从不关闭" });
    expect(chinese.headline).toMatch(/^估计每月 S\$\d+ 的电费中，约有 S\$\d+ 花在全天候开着的设备上，即使没人在场也一样。$/);
    expect(chinese.masthead).toEqual({ site: "Tuya Office", detail: "6 Battery Road, 27 楼 · 办公室能源报告", period: "2026年8月3日–16日", periodNote: "14 天，SGT" });
    expect(chinese.lede).toContain("在 14 天里，办公室共用电 **1,148 kWh**，来自 6 条有电表的线路。");
    expect(chinese.circuits.map(item => item.name).sort()).toEqual(["3 个 LED Display", "Office Area 插座与设备", "Office Area 照明", "Shared Area 插座与设备"]);
    expect(circuit(chinese, "LED Display 1–3").label).toBe("3 个 LED Display（分区 C）");
    expect(chinese.profile.intro).toContain("Tuya Office 占用 **6 Battery Road 27 楼的一半，约 700 m²**。");
    expect(chinese.profile.zones[0]).toEqual({ heading: "分区 A（从入口右转 · 配电箱 DB1）", text: "Open office和Director room。对应线路为 Office Area 照明（DB1 L1 Light）和Office Area 插座与设备（DB1 L1 Power）。" });
    expect(chinese.estimate.intro).toContain("**S$0.3000/kWh（未含消费税）**");
    expect(chinese.pattern!.intro).toContain("午餐时段回落（约 4.3 kW，中午12点–下午2点）");
    expect(chinese.pattern!.notes.map(note => note.text)).toEqual(expect.arrayContaining(["上班后用电上升", "午餐低谷"]));
    expect(circuit(chinese, "LED Display 1–3").finding).toBe("**336 小时内零偏离。**全部 3 个都在整整 14 天里持续运行，从未调暗，也从未关闭。");
    expect(circuit(chinese, "DB1 L1 Light").finding).toBe("在**全部 10 个工作日**，下午6点之后照明仍亮着（约 1.2 kWh/h），通常到晚上8点才关。");
    expect(chinese.screening.rows.find(row => row.code === "LED Display 1–3")!.open).toBe("每个 0.19");
    expect(chinese.footer.right).toBe("生成于 2026年9月22日 · 数据根据最新读数重新计算");
    expect(englishLeft(prose(chinese))).toEqual([]);
  });

  it("writes the Malay report in Bahasa Melayu", () => {
    expect(malay.title).toEqual({ before: "Lebih daripada empat perlima beban pejabat ", emphasis: "tidak pernah dimatikan" });
    expect(malay.masthead.period).toBe("3–16 Ogo 2026");
    expect(malay.circuits.map(item => item.name).sort()).toEqual(["3 unit LED Display", "Lampu Office Area", "Peralatan & soket Office Area", "Peralatan & soket Shared Area"]);
    expect(circuit(malay, "LED Display 1–3").finding).toBe("**Sifar sisihan dalam 336 jam.** Kesemua 3 unit berjalan tanpa henti sepanjang 14 hari — tidak pernah malap, tidak pernah dimatikan.");
    expect(circuit(malay, "DB1 L1 Light").finding).toBe("Masih menyala selepas 6 petang pada **kesemua 10 hari bekerja** (~1.2 kWh/h), biasanya hingga 8 malam.");
    expect(malay.benchmark.rows.map(row => row.label)).toEqual(["Purata hari bekerja", "Purata hujung minggu", "Beban asas (penggunaan terbiar 24/7)"]);
    expect(malay.headline).toMatch(/^Kira-kira S\$\d+ daripada anggaran bil bulanan S\$\d+ dibayar untuk peralatan yang hidup sepanjang masa, walaupun tiada sesiapa di situ\.$/);
    const malayWords = new Set(["Ia", "ia"]);
    expect(englishLeft(prose(malay)).filter(word => /^(the|and|of|is|are|with|from|per|weekday|weekend|hours?|lights?|equipment|never|after|before|average|load|zone|Weekday|Weekend|Base|Zone|Lit|Still|Steady|Zero|Nothing|Switching|Method|Cost|Across)$/.test(word) && !malayWords.has(word))).toEqual([]);
  });

  it("swaps panel codes for the translated everyday names, without lowering them", () => {
    expect(plainNames(chinese)("检查 DB1 L1 Light 的规则")).toBe("检查 Office Area 照明 的规则");
    expect(plainNames(malay)("Semak peraturan DB1 L1 Light.")).toBe("Semak peraturan Lampu Office Area.");
    expect(plainNames(english)("Check a rule for DB1 L1 Light.")).toBe("Check a rule for office area lights.");
  });
});

describe("site report page in other languages", () => {
  it("shows the whole panel in Chinese, with no English wording left", async () => {
    const report = buildSiteReport(DATA, REFERENCE, GENERATED, "zh-Hans");
    const page = await render("zh-Hans", <SiteReportPanel state={{ report }} onRetry={() => undefined} />);
    expect([...page.host.querySelectorAll("h2")].map(heading => heading.textContent)).toEqual(["完整报告", "物业概况与线路图", "30 天估算与电费", "基准对比：工作日、周末和基础用电", "工作日营业时段用电规律", "按线路的异常筛查"]);
    expect(page.host.querySelector("h1")?.textContent).toBe("超过五分之四的办公室用电从不关闭");
    expect(page.host.querySelector('section[aria-label="能源报告"] button')?.textContent).toBe("下载");
    expect(page.host.querySelector('article[aria-label="Tuya Office 能源报告"]')).not.toBeNull();
    expect(page.host.querySelector('svg[aria-label="Tuya Office 的楼层示意图"]')).not.toBeNull();
    expect(page.host.querySelector('svg[aria-label="每日用电量，含工作日平均线和基础用电线"]')).not.toBeNull();
    for (const text of ["时段：2026年8月3日–16日（14 天，SGT）", "午餐低谷的原因：", "如何解读筛查结果：", "办公室合计", "估算 30 天", "工作日平均", "只有基础用电的一天", "电气面板（配电箱）", "右转 · 分区 A", "左转 · 分区 B + C", "营业时间 上午9点–下午6点", "平均需求（kW）"]) expect(page.text()).toContain(text);
    // Everything a reader can see or hear: visible text, accessible names and hover titles.
    const labels = [...page.host.querySelectorAll("[aria-label]")].map(node => node.getAttribute("aria-label")!);
    const titles = [...page.host.querySelectorAll("title")].map(node => node.textContent ?? "");
    expect(englishLeft([...visibleTexts(page.host), ...labels, ...titles])).toEqual([]);
    const html = standaloneReportHtml(page.host.querySelector("article")!, report);
    expect(html).toContain('<html lang="zh-Hans">');
    expect(html).toContain("<title>Tuya Office 能源报告 · 2026年8月3日–16日</title>");
    await page.unmount();
  });

  it("shows the panel's loading and error states in Malay", async () => {
    const loading = await render("ms", <SiteReportPanel state={null} onRetry={() => undefined} />);
    expect(loading.text()).toContain("Menyediakan laporan daripada bacaan terkini…");
    expect(loading.host.querySelector("h2")?.textContent).toBe("Laporan penuh");
    await loading.unmount();
    // A failure names the problem and the steps to fix it, in the reader's language.
    const failed = await render("ms", <SiteReportPanel projectId="p" state={{ error: { title: "Bilik Bos belum mempunyai meter, jadi angkanya tidak dapat dijumlahkan", steps: ["Buka Fasiliti → Susun atur lantai dan pilih Bilik Bos."], fixTab: "structure" } }} onRetry={() => undefined} />);
    const alert = failed.host.querySelector('[role="alert"]');
    expect(alert?.querySelector("h3")?.textContent).toBe("Bilik Bos belum mempunyai meter, jadi angkanya tidak dapat dijumlahkan");
    expect(alert?.querySelector("li")?.textContent).toBe("Buka Fasiliti → Susun atur lantai dan pilih Bilik Bos.");
    expect(alert?.querySelector("a")?.textContent).toBe("Buka Fasiliti");
    expect(alert?.querySelector("button")?.textContent).toBe("Cuba lagi");
    await failed.unmount();
  });

  it("labels the floor layout map and board legend in Chinese", async () => {
    const page = await render("zh-Hans", <><SiteFloorMap reference={REFERENCE} devices={[{ id: "led-1", name: "LED Display 1", board: "DB3", position: [60, 200] }]} onSelectBoard={() => undefined} onOpenDevice={() => undefined} /><BoardLegend reference={REFERENCE} /></>);
    expect(page.host.querySelector("svg")?.getAttribute("aria-label")).toBe("楼层布局：按配电箱分组的房间，共 1 台设备。仅为示意，未按比例绘制。");
    expect(page.host.querySelector('[aria-label="选择 DB1，区域 A"]')).not.toBeNull();
    expect(page.host.querySelector('[aria-label="选择 DB2：Pantry"]')).not.toBeNull();
    expect(page.host.querySelector('[aria-label="选择 DB3：Three large LED panels"]')).not.toBeNull();
    expect(page.host.querySelector('[aria-label="打开 LED Display 1"] title')?.textContent).toBe("LED Display 1 · DB3 · 点击打开");
    expect(page.text()).toContain("仅为示意 · 未按比例绘制");
    expect(page.host.querySelector('ul[aria-label="配电箱"]')?.textContent).toContain("DB3 · 位于Showroom内Showroom内的Three large LED panels");
    await page.unmount();
  });

  // The server saves the page in English and keeps the readings beside it, so the reader gets the same report in
  // their own language without the engine being asked for anything.
  it("writes the saved report in the reader's language, from the readings kept with it", async () => {
    const stored = serializeSiteReportSnapshot({
      schemaVersion: 1, projectId: "tuya-office", cadence: "monthly", period: { from: DATES[0]!, toExclusive: "2026-08-17" },
      generatedAt: GENERATED, language: "en", reference: REFERENCE, historyOmitted: true, data: DATA,
    });
    vi.spyOn(configApi, "reportLibraryRequest").mockImplementation(async (_projectId: string, action = "") =>
      (action ? { snapshot: stored } : { reports: [{ id: "site-monthly", source: "site", cadence: "monthly" }], overviewCadence: "monthly" }) as never);
    vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({ periodOptions: { availablePeriod: null } });
    function Probe() {
      const { state, saved } = useSiteReport("tuya-office", null);
      const report = state && "report" in state ? state.report : null;
      return <><h1>{report ? `${report.title.before}${report.title.emphasis}` : "…"}</h1><SiteReportPanel state={state} onRetry={() => undefined} saved={saved} /></>;
    }
    const page = await render("zh-Hans", <Probe />);
    for (let tick = 0; tick < 4; tick += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(page.host.querySelector("h1")?.textContent).toBe("超过五分之四的办公室用电从不关闭");
    expect(page.text()).toContain("已于 2026年9月22日 保存，并存放在“报告”中");
    expect(page.text()).toContain("时段：2026年8月3日–16日（14 天，SGT）");
    const labels = [...page.host.querySelectorAll("[aria-label]")].map(node => node.getAttribute("aria-label")!);
    const titles = [...page.host.querySelectorAll("title")].map(node => node.textContent ?? "");
    expect(englishLeft([...visibleTexts(page.host), ...labels, ...titles])).toEqual([]);
    // The readings came with the saved report; the engine was never asked.
    expect(mock.load).not.toHaveBeenCalled();
    await page.unmount();
  });

  it("rewrites the report when the language changes, without loading the readings again", async () => {
    mock.load.mockResolvedValue(DATA);
    // Nothing has been saved for this project, so the readings are loaded and the report is built here.
    vi.spyOn(configApi, "reportLibraryRequest").mockResolvedValue({ reports: [] });
    const notes = vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({ settings: { contextNotes: "" } });
    function Probe() {
      const { setLocale } = useEnergyIqLocale();
      const { state } = useSiteReport("tuya-office", { from: DATES[0]!, to: DATES.at(-1)! });
      const report = state && "report" in state ? state.report : null;
      return <><h1>{report ? `${report.title.before}${report.title.emphasis}` : "…"}</h1><p>{report?.headlineTopic}</p><button type="button" onClick={() => setLocale("ms")}>ms</button></>;
    }
    const page = await render("zh-Hans", <Probe />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(page.host.querySelector("h1")?.textContent).toBe("超过五分之四的办公室用电从不关闭");
    await act(async () => page.host.querySelector("button")!.click());
    expect(page.host.querySelector("h1")?.textContent).toBe("Lebih daripada empat perlima beban pejabat tidak pernah dimatikan");
    expect(page.host.querySelector("p")?.textContent).toBe("always-on");
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(notes).toHaveBeenCalledTimes(1);
    await page.unmount();
  });
});
