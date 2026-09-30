/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnergyOperatingCalendarEntryDto, EnergyProjectSetupDocumentDto, EnergyScopeAnalysisDto } from "../../../lib/config-api";

const mock = vi.hoisted(() => ({ search: "", analysis: vi.fn(), policies: vi.fn(), information: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/energyiq/project-configuration", useSearchParams: () => new URLSearchParams(mock.search) }));
// The meter-health notice on Devices fetches on mount; these tests only check wording, so it stays empty.
vi.mock("../../../lib/config-api", () => ({ configApi: { executeEnergyScopeAnalysis: mock.analysis, getEnergyOperationalPolicies: mock.policies, getEnergyProjectInformation: mock.information, getEnergyProjectMeterHealth: vi.fn(async () => ({ meters: [] })) } }));

import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import { dayContext, describeDay, specialDays } from "./day-context";
import { openingHoursLabel, type DeviceStatistics } from "./device-statistics";
import { boardTotalNote, deviceFindings, energyBreakdown, formatPeriod, siteFindings, SiteDevices, type DeviceRow } from "./site-devices";
import { applyLocationEdit, applyMeterMoves, locationRemoval, measurementLabel, MeterTotalsCheck, MoveMetersForm } from "./site-structure-editing";
import { PublishedProjectInformation } from "./project-information";
import { ProjectSpatialPreview } from "./project-spatial-preview";

const weekday = [{ from: "09:00", to: "18:00" }];
const entries = [{
  id: "hours", owner: { kind: "project" }, effective_from: "2026-07-01", effective_to: "2027-01-01",
  weekly: { monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: [], sunday: [] },
  exceptions: [{ date: "2026-08-17", operating: [], label: "Company day", classification: "public_holiday" }],
}] as unknown as EnergyOperatingCalendarEntryDto[];
const revision = { version_id: "cal-1", entries, academic_periods: [] };

describe("facility wording helpers in other languages", () => {
  it("keeps English by default and follows Chinese and Malay when asked", () => {
    expect(openingHoursLabel(entries)).toBe("Mon–Fri 09:00–18:00");
    expect(openingHoursLabel(entries, "zh-Hans")).toBe("周一至周五 09:00–18:00");
    expect(openingHoursLabel(entries, "ms")).toBe("Isn–Jum 09:00–18:00");

    const holiday = dayContext(revision as never, "2026-08-17");
    expect(describeDay(holiday)).toBe("Company day (public holiday) · closed");
    expect(describeDay(holiday, true, "zh-Hans")).toBe("Company day（公共假期） · 不开放");
    expect(describeDay(holiday, false, "ms")).toBe("Cuti umum · tutup");
    expect(specialDays([holiday], new Map([["2026-08-17", 95]]), { openDayKwh: 100, closedDayKwh: 60 }, "zh-Hans")[0]!.verdict).toContain("可能有设备没有关掉");

    expect(formatPeriod("2026-08-13T16:00:00.000Z", "2026-09-10T16:00:00.000Z", "Asia/Singapore", "zh-Hans")).toBe("2026年8月14日 – 9月10日");
    expect(formatPeriod("2026-08-13T16:00:00.000Z", "2026-09-10T16:00:00.000Z", "Asia/Singapore", "ms")).toBe("14 Ogo – 10 Sep 2026");
    expect(boardTotalNote("Lighting", "zh-Hans")).toBe("此配电箱的照明总量");
    expect(measurementLabel("aircon", "ms")).toBe("Penyaman udara");
    expect(measurementLabel("unknown", "zh-Hans")).toBe("其他");
  });

  it("writes findings as whole sentences in the reader's language", () => {
    const row = { id: "m1", name: "Showroom Conow", boardId: "db2", category: "load", type: "Power", isBoardTotal: false, usageKwh: 500, peakKw: 1, coveragePct: 99, status: "reporting" } as DeviceRow;
    const stat = { daily: [], profileKw: [], openProfileKw: [], closedProfileKw: [], openDays: 20, closedDays: 8, outOfHoursKwh: 360, outOfHoursPct: 72, alwaysOnKw: 0.01, dailyAverageKwh: 18, openDayAverageKwh: 20, closedDayAverageKwh: 5, receivedPct: 99 } as DeviceStatistics;
    const [zh] = deviceFindings({ row, stat, rate: 0.3, openingHours: "周一至周五 09:00–18:00", locale: "zh-Hans" });
    expect(zh).toEqual({ icon: "alert", title: "大多在工作时间以外运行", detail: "有 360 kWh（占其用电的 72%）是在周一至周五 09:00–18:00以外使用的，约 SGD 108。值得检查那段时间是否真的需要运行。" });
    const [ms] = deviceFindings({ row, stat, rate: null, openingHours: null, locale: "ms" });
    expect(ms!.detail).toBe("360 kWh (72% daripada penggunaannya) berlaku di luar waktu operasi. Wajar disemak sama ada ia perlu beroperasi pada waktu itu.");

    const rows = [
      { ...row, id: "total", name: "DB1 Power", boardId: "db1", isBoardTotal: true, usageKwh: 600 },
      { ...row, id: "dev", name: "Pantry", boardId: "db1", usageKwh: 100 },
      { ...row, id: "quiet", name: "Store", boardId: "db1", usageKwh: null, status: "silent", circuit: "L2P3" },
    ] as DeviceRow[];
    const shares = energyBreakdown(rows, new Map([["db1", "DB1"]]), "zh-Hans");
    expect(shares.find(share => share.unmetered)?.name).toBe("DB1 其他插座用电回路");
    expect(energyBreakdown(rows, new Map([["db1", "DB1"]]), "ms").find(share => share.unmetered)?.name).toBe("Litar kuasa lain di DB1");
    const findings = siteFindings({ rows, stats: new Map(), shares, siteKwh: 700, rate: null, openingHours: null, board: "DB1", locale: "zh-Hans" });
    expect(findings.map(finding => finding.title)).toEqual(["Pantry 是用电最多的单一设备", "部分用电无法对应到具体设备", "1 台设备没有发送读数"]);
    expect(findings[0]!.detail).toBe("占 DB1 全部用电的 14%：这 28 天共 100 kWh。");
    expect(findings[2]!.detail).toBe("Store（L2P3）。请检查它们是否已通电并已连接。");
  });

  it("returns editing errors in the reader's language and English by default", () => {
    const document = {
      project: { name: "Office", timezone: "Asia/Singapore" }, tiers: [{ id: "db", ordinal: 1, alias: "Distribution Board" }],
      nodes: [{ id: "db1", tier_definition_id: "db", name: "DB1", sort_order: 10, metadata_status: "confirmed" }],
      meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, rows: [{ id: "m1", scope_id: "db1", navigation_scope_id: "db1", display_name: "m1", resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official" }], official_aggregation_routes: [] },
    } as unknown as EnergyProjectSetupDocumentDto;
    expect(applyLocationEdit(document, "p", { node: document.nodes[0]! }, { name: " ", area: "", occupants: "" })).toEqual({ error: "Enter a name." });
    expect(applyLocationEdit(document, "p", { node: document.nodes[0]! }, { name: " ", area: "", occupants: "" }, "zh-Hans")).toEqual({ error: "请输入名称。" });
    expect(locationRemoval(document, "db1", "ms")).toEqual({ error: "Alihkan 1 meter di lokasi ini ke lokasi lain dahulu." });
    expect(applyMeterMoves(document, [], "db1")).toEqual({ error: "Tick at least one meter to move." });
    expect(applyMeterMoves(document, [], "db1", "zh-Hans")).toEqual({ error: "请至少勾选一个要移动的电表。" });
  });
});

// One board with one device over a week that includes a public holiday.
const dates = ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
const cells = dates.flatMap(date => Array.from({ length: 24 }, (_, hour): [string, number, number, number, number] => [date, hour, hour >= 9 && hour < 18 ? 2 : 0.5, 60, 0]));
const health = { coveragePct: 100, expectedMeterIntervalCount: 672, validIntervalCount: 672, qualityEventCount: 0 };
const analysis = (trends: Array<{ id: string; expectedMinutesPerHour: number; cells: typeof cells }>) => ({
  context: { from: "2026-08-13T16:00:00.000Z", to: "2026-08-20T16:00:00.000Z", timezone: "Asia/Singapore" },
  summary: { usageKwh: 210, averageDailyUsageKwh: 30, peakKw: 2.4, peakAt: "2026-08-18T03:15:00.000Z" },
  circuits: [{ meterNodeId: "m1", name: "Pantry fridge", usageKwh: 210, peakKw: 2.4, dataHealth: health }],
  explorerMeters: [{ id: "m1", name: "Pantry fridge", circuitName: "L1P2", scopeId: "db1", kind: "physical", role: "component", category: "load" }],
  explorerTrends: trends,
  cost: { status: "available", amount: 63, allocations: [{ usageKwh: 210, ratePerKwh: 0.3, rateBasis: "tax_exclusive", tax: { name: "GST", ratePct: 9 } }] },
  offHours: { status: "available", businessCalendarVersion: "cal-1", sharePct: 40, usageKwh: 84 },
}) as unknown as EnergyScopeAnalysisDto;

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mock.search = "";
  mock.analysis.mockImplementation(async ({ scopeId }: { scopeId: string }) => scopeId === "project"
    ? analysis([{ id: "__scope__", expectedMinutesPerHour: 60, cells }, { id: "__category__:load", expectedMinutesPerHour: 60, cells }])
    : analysis([{ id: "m1", expectedMinutesPerHour: 60, cells }]));
  mock.policies.mockResolvedValue({ published: { business_calendar_version: "cal-1" }, operatingCalendarRevisions: [revision] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function render(locale: EnergyIqLocale, node: ReactNode) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  await act(async () => root.render(<EnergyIqLocaleProvider key={locale}>{node}</EnergyIqLocaleProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe("Facility pages in other languages", () => {
  it("shows the Devices tab in Chinese, including charts, findings and the method note", async () => {
    await render("zh-Hans", <SiteDevices projectId="p" boardNames={new Map([["db1", "DB1"]])} />);
    const text = container.textContent ?? "";
    expect(container.querySelector("h3")?.textContent).toBe("设备");
    for (const phrase of ["值得注意的地方", "场地统计", "开放日与休息日对比", "用电去向", "所有设备：完整统计", "本期间的特殊日子", "公共假期", "这些数据是怎么算出来的", "周一至周五 09:00–18:00", "2026年8月14日–20日", "读数正常", "插座用电", "不含 GST"]) expect(text).toContain(phrase);
    for (const english of ["What stands out", "Energy used", "Where the energy goes", "Reporting", "Special days", "Closed day"]) expect(text).not.toContain(english);
    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("显示整个场地或单个配电箱");
  });

  it("shows one device in Malay", async () => {
    mock.search = "view=device:m1";
    await render("ms", <SiteDevices projectId="p" boardNames={new Map([["db1", "DB1"]])} />);
    const text = container.textContent ?? "";
    for (const phrase of ["Seluruh premis", "Statistik", "Setiap hari, jam demi jam", "Minggu bermula", "Hari buka biasa", "Litar L1P2", "Cara angka ini dikira"]) expect(text).toContain(phrase);
    expect(text).not.toContain("Every day, hour by hour");
  });

  it("shows published project information, the floor layout and meter checks in Chinese and Malay", async () => {
    mock.information.mockResolvedValue({ name: "Harbour Office", timezone: "Asia/Singapore", basis: "published", locations: [{ id: "a", name: "Level 1", parentId: null }], meters: [], calendar: { version: "c", entries: [{ location: "Level 1", from: "2026-07-01", toExclusive: null, weekly: { monday: weekday, sunday: [] }, exceptions: [] }] }, tariff: { version: "t", entries: [{ location: "Level 1", from: "2026-07-01", toExclusive: "2027-01-01", currency: "SGD", ratePerKwh: 0.3, taxBasis: "tax_exclusive", tax: { name: "GST", ratePct: 9 } }] } });
    await render("zh-Hans", <PublishedProjectInformation projectId="p" />);
    for (const phrase of ["场地设施", "已发布的配置", "星期一", "不开放", "自 2026-07-01 起生效，至 2027-01-01 前结束（不含当天）", "不含税"]) expect(container.textContent).toContain(phrase);

    const notes = "Brief\n```json\n" + JSON.stringify({ schemaVersion: 1, projectId: "p", provenance: { file: "reference.html", status: "reference-derived" }, layout: { viewBox: [0, 0, 800, 500], zones: [{ id: "A", referenceBoard: "DB1", rect: [10, 10, 300, 300] }], rooms: [{ name: "Office", zone: "A", rect: [20, 60, 200, 150] }] } }) + "\n```";
    await render("ms", <ProjectSpatialPreview notes={notes} projectId="p" />);
    for (const phrase of ["Susun atur lantai & papan agihan", "Besarkan", "Papan agihan", "Ringkasan projek", "Sumber: reference.html"]) expect(container.textContent).toContain(phrase);

    const document = {
      project: { name: "Office", timezone: "Asia/Singapore" }, tiers: [{ id: "db", ordinal: 1, alias: "Distribution Board" }],
      nodes: [{ id: "db1", tier_definition_id: "db", name: "DB1", sort_order: 10, metadata_status: "confirmed" }, { id: "db2", tier_definition_id: "db", name: "DB2", sort_order: 20, metadata_status: "confirmed" }],
      meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: false, rows: [{ id: "m1", scope_id: "gone", navigation_scope_id: "gone", display_name: "Fridge", resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official" }], official_aggregation_routes: [] },
    } as unknown as EnergyProjectSetupDocumentDto;
    await render("zh-Hans", <><MeterTotalsCheck document={document} busy={false} onConfirm={() => undefined} /><MoveMetersForm document={document} targetId="db2" busy={false} error="" onSave={() => undefined} onCancel={() => undefined} /></>);
    for (const phrase of ["发布前请核对电表总量", "有 1 个电表没有位置。", "确认电表总量", "把电表移到 DB2", "目前在 尚无位置", "照明", "取消", "保存"]) expect(container.textContent).toContain(phrase);
  });
});
